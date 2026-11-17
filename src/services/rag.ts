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

export class RagService {
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
        return invoke<{ chunkCount: number }>("rag_index_document", {
            scope,
            config,
            embeddingConfig,
        });
    }

    /**
     * Removes a document's vector index and catalog entry from `rag.db`.
     */
    public static async removeDocumentIndex(docId: string): Promise<void> {
        await invoke("rag_remove_document_index", { docId });
    }

    /**
     * Retrieves the persistent RAG catalog of indexed documents from `rag.db`.
     */
    public static async getRagCatalog(): Promise<RagCatalog> {
        return invoke<RagCatalog>("rag_get_catalog");
    }

    /**
     * Retrieves all indexed chunks for a specific document.
     */
    public static async getDocumentChunks(docId: string): Promise<DocumentChunk[]> {
        return invoke<DocumentChunk[]>("rag_get_document_chunks", { docId });
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