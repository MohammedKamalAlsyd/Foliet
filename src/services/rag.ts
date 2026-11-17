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
    CatalogEntry,
} from "@/types/embedding";

export let USE_MOCK_RAG = false;

export function setUseMockRag(value: boolean): void {
    USE_MOCK_RAG = value;
}

// =============================================================================
// Mock Fallback Store (Browser-Only Dev Mode)
// =============================================================================

const mockDownloadListeners = new Set<(progress: ModelDownloadProgress) => void>();
const mockCatalog: RagCatalog = { documents: [] };
const mockChunksStore = new Map<string, DocumentChunk[]>();

function isCommandNotFoundError(err: any): boolean {
    const message = typeof err === "string" ? err : err?.message || "";
    return (
        (message.includes("command") &&
            (message.includes("not found") || message.includes("not registered"))) ||
        message.includes("is not implemented") ||
        message.includes("__TAURI_INTERNALS__")
    );
}

export class RagService {
    /**
     * Checks availability and download status for the specified embedding model.
     */
    public static async getModelStatus(
        provider: EmbeddingProvider,
        modelId: string
    ): Promise<ModelStatus> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<ModelStatus>("rag_get_model_status", {
                    provider,
                    modelId,
                });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock getModelStatus.");
            }
        }

        return {
            modelId,
            isAvailable: true,
            isDownloading: false,
            fileSizeMb: 0,
            provider,
        };
    }

    /**
     * Downloads a local ONNX embedding model into `<app_data_dir>/rag_models/`.
     */
    public static async downloadModel(modelId: string): Promise<void> {
        if (!USE_MOCK_RAG) {
            try {
                await invoke("rag_download_model", { modelId });
                return;
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock downloadModel.");
            }
        }

        mockDownloadListeners.forEach((listener) =>
            listener({
                modelId,
                percent: 100,
                downloadedBytes: 0,
                totalBytes: 0,
                isComplete: true,
            })
        );
    }

    /**
     * Unloads any cached ONNX session for `modelId` and removes its files from disk.
     */
    public static async deleteModel(modelId: string): Promise<void> {
        if (!USE_MOCK_RAG) {
            try {
                await invoke("rag_delete_model", { modelId });
                return;
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock deleteModel.");
            }
        }
    }

    /**
     * Lists downloaded local embedding models and their sizes on disk.
     */
    public static async listDownloadedModels(): Promise<DownloadedModelInfo[]> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<DownloadedModelInfo[]>("rag_list_downloaded_models");
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock listDownloadedModels.");
            }
        }
        return [];
    }

    /**
     * Listens for local embedding model download progress events.
     */
    public static async onModelDownloadProgress(
        callback: (progress: ModelDownloadProgress) => void
    ): Promise<UnlistenFn> {
        mockDownloadListeners.add(callback);

        let tauriUnlisten: UnlistenFn | null = null;
        try {
            tauriUnlisten = await listen<ModelDownloadProgress>(
                "rag_model_download_progress",
                (event) => callback(event.payload)
            );
        } catch {
            // Browser mode fallback
        }

        return () => {
            mockDownloadListeners.delete(callback);
            tauriUnlisten?.();
        };
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
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<{ chunkCount: number }>("rag_index_document", {
                    scope,
                    config,
                    embeddingConfig,
                });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock indexDocument.");
            }
        }

        const filteredDocs: CatalogEntry[] = mockCatalog.documents.filter(
            (d) => d.docId !== scope.docId
        );
        filteredDocs.push({
            docId: scope.docId,
            docTitle: scope.docTitle,
            filePath: scope.filePath,
            chunkCount: 0,
            embeddingModel: embeddingConfig.model,
            provider: embeddingConfig.provider,
            indexedAt: new Date().toISOString(),
        });
        mockCatalog.documents = filteredDocs;
        return { chunkCount: 0 };
    }

    /**
     * Removes a document's vector index and catalog entry from `rag.db`.
     */
    public static async removeDocumentIndex(docId: string): Promise<void> {
        if (!USE_MOCK_RAG) {
            try {
                await invoke("rag_remove_document_index", { docId });
                return;
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock removeDocumentIndex.");
            }
        }

        mockChunksStore.delete(docId);
        mockCatalog.documents = mockCatalog.documents.filter((d) => d.docId !== docId);
    }

    /**
     * Retrieves the persistent RAG catalog of indexed documents from `rag.db`.
     */
    public static async getRagCatalog(): Promise<RagCatalog> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<RagCatalog>("rag_get_catalog");
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock getRagCatalog.");
            }
        }

        return { documents: [...mockCatalog.documents] };
    }

    /**
     * Retrieves all indexed chunks for a specific document.
     */
    public static async getDocumentChunks(docId: string): Promise<DocumentChunk[]> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<DocumentChunk[]>("rag_get_document_chunks", { docId });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock getDocumentChunks.");
            }
        }

        return mockChunksStore.get(docId) ?? [];
    }

    /**
     * Performs dense semantic search against `rag.db` in Rust.
     */
    public static async searchRag(
        query: RagSearchQuery,
        embeddingConfig: EmbeddingConfig
    ): Promise<RagSearchResult[]> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<RagSearchResult[]>("rag_search", {
                    query,
                    embeddingConfig,
                });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Falling back to mock searchRag.");
            }
        }

        return [];
    }
}