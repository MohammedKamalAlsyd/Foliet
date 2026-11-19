/**
 * Foliet - Typed RAG IPC Service
 *
 * Provides a strongly-typed IPC interface to the Tauri / Rust embedding
 * and dense retrieval backend (`src-tauri/src/rag/`).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
    EmbeddingProvider,
    EmbeddingConfig,
    ModelStatus,
    ModelDownloadProgress,
    DownloadedModelInfo,
    RagIndexProgress,
    IndexingScope,
    RagHyperparameters,
    RagCatalog,
    DocumentChunk,
    RagSearchQuery,
    RagSearchResult,
} from "@/types/embedding";

interface CachedDocumentChunks {
    chunks: DocumentChunk[];
    byPage: Map<number, DocumentChunk[]>;
}

const MAX_CACHED_CHUNK_DOCS = 4;

export class RagService {
    private static chunkCache = new Map<string, CachedDocumentChunks>();
    private static inFlightChunkRequests = new Map<string, Promise<CachedDocumentChunks>>();

    private static buildChunkCacheEntry(chunks: DocumentChunk[]): CachedDocumentChunks {
        const byPage = new Map<number, DocumentChunk[]>();
        for (const chunk of chunks) {
            const list = byPage.get(chunk.pageNumber);
            if (list) list.push(chunk);
            else byPage.set(chunk.pageNumber, [chunk]);
        }
        for (const list of byPage.values()) {
            list.sort((a, b) => a.chunkIndex - b.chunkIndex);
        }
        return { chunks, byPage };
    }

    private static setChunkCache(docId: string, entry: CachedDocumentChunks): void {
        if (this.chunkCache.has(docId)) {
            this.chunkCache.delete(docId);
        }
        this.chunkCache.set(docId, entry);
        while (this.chunkCache.size > MAX_CACHED_CHUNK_DOCS) {
            const oldestKey = this.chunkCache.keys().next().value;
            if (oldestKey === undefined) break;
            this.chunkCache.delete(oldestKey);
        }
    }

    public static invalidateDocumentChunks(docId?: string): void {
        if (!docId) {
            this.chunkCache.clear();
            return;
        }
        this.chunkCache.delete(docId);
    }

    private static async getCachedDocumentChunksEntry(
        docId: string,
        forceRefresh = false
    ): Promise<CachedDocumentChunks> {
        if (!forceRefresh) {
            const cached = this.chunkCache.get(docId);
            if (cached) {
                this.chunkCache.delete(docId);
                this.chunkCache.set(docId, cached);
                return cached;
            }
            const inFlight = this.inFlightChunkRequests.get(docId);
            if (inFlight) return inFlight;
        }

        const req = invoke<DocumentChunk[]>("rag_get_document_chunks", { docId })
            .then((chunks) => {
                const entry = this.buildChunkCacheEntry(chunks);
                this.setChunkCache(docId, entry);
                return entry;
            })
            .finally(() => {
                if (this.inFlightChunkRequests.get(docId) === req) {
                    this.inFlightChunkRequests.delete(docId);
                }
            });

        this.inFlightChunkRequests.set(docId, req);
        return req;
    }
    /**
     * Checks availability and download status for the specified embedding model.
     */
    public static async getModelStatus(
        provider: EmbeddingProvider,
        modelId: string
    ): Promise<ModelStatus> {
        return invoke<ModelStatus>("rag_get_model_status", {
            provider,
            modelId,
        });
    }

    /**
     * Downloads a local ONNX embedding model into `<app_data_dir>/rag_models/`.
     */
    public static async downloadModel(modelId: string): Promise<void> {
        await invoke("rag_download_model", { modelId });
    }

    /**
     * Unloads any cached ONNX session for `modelId` and removes its files from disk.
     */
    public static async deleteModel(modelId: string): Promise<void> {
        await invoke("rag_delete_model", { modelId });
    }

    /**
     * Lists downloaded local embedding models and their sizes on disk.
     */
    public static async listDownloadedModels(): Promise<DownloadedModelInfo[]> {
        return invoke<DownloadedModelInfo[]>("rag_list_downloaded_models");
    }

    /**
     * Listens for local embedding model download progress events.
     */
    public static async onModelDownloadProgress(
        callback: (progress: ModelDownloadProgress) => void
    ): Promise<UnlistenFn> {
        try {
            return await listen<ModelDownloadProgress>(
                "rag_model_download_progress",
                (event) => callback(event.payload)
            );
        } catch {
            return () => { };
        }
    }

    /**
     * Listens for page/chunk indexing progress events (`rag_index_progress`).
     */
    public static async onIndexProgress(
        callback: (progress: RagIndexProgress) => void
    ): Promise<UnlistenFn> {
        try {
            return await listen<RagIndexProgress>("rag_index_progress", (event) =>
                callback(event.payload)
            );
        } catch {
            return () => { };
        }
    }

    /**
     * Indexes a PDF into `rag.db` using the provided scope, RAG hyperparameters,
     * and active embedding provider/model/API key configuration.
     */
    public static async indexDocument(
        scope: IndexingScope,
        config: RagHyperparameters,
        embeddingConfig: EmbeddingConfig
    ): Promise<{ chunkCount: number }> {
        this.invalidateDocumentChunks(scope.docId);
        const result = await invoke<{ chunkCount: number }>("rag_index_document", {
            scope,
            config,
            embeddingConfig,
        });
        this.invalidateDocumentChunks(scope.docId);
        return result;
    }

    /**
     * Removes a document's vector index and catalog entry from `rag.db`.
     */
    public static async removeDocumentIndex(docId: string): Promise<void> {
        this.invalidateDocumentChunks(docId);
        await invoke("rag_remove_document_index", { docId });
    }

    /**
     * Retrieves the persistent RAG catalog of indexed documents from `rag.db`.
     */
    public static async getRagCatalog(): Promise<RagCatalog> {
        return invoke<RagCatalog>("rag_get_catalog");
    }

    /**
     * Retrieves all indexed chunks for a specific document (cached per docId).
     */
    public static async getDocumentChunks(
        docId: string,
        options?: { forceRefresh?: boolean }
    ): Promise<DocumentChunk[]> {
        const entry = await this.getCachedDocumentChunksEntry(
            docId,
            options?.forceRefresh ?? false
        );
        return entry.chunks;
    }

    /**
     * Retrieves indexed chunks scoped to `[startPage, endPage]` using the
     * per-document page index cache so citation clicks avoid repeated IPC calls.
     */
    public static async getPageChunks(
        docId: string,
        startPage: number,
        endPage = startPage
    ): Promise<DocumentChunk[]> {
        const entry = await this.getCachedDocumentChunksEntry(docId);
        if (startPage === endPage) {
            return entry.byPage.get(startPage) ?? [];
        }
        const results: DocumentChunk[] = [];
        for (let page = startPage; page <= endPage; page++) {
            const pageList = entry.byPage.get(page);
            if (pageList) results.push(...pageList);
        }
        return results;
    }

    /**
     * Performs dense semantic search against `rag.db` in Rust.
     */
    public static async searchRag(
        query: RagSearchQuery,
        embeddingConfig: EmbeddingConfig
    ): Promise<RagSearchResult[]> {
        return invoke<RagSearchResult[]>("rag_search", {
            query,
            embeddingConfig,
        });
    }
}