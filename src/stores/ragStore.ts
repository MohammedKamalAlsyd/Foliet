/**
 * Foliet - RAG Runtime Store
 *
 * Manages dense vector indexing via Rust (`rag.db`), catalog sync,
 * chunk inspection, local ONNX model lifecycle, and semantic retrieval.
 */

import { create } from "zustand";
import { RagService } from "@/services/rag";
import { DocumentCatalogStorage } from "@/services/storage/catalog";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { RagSearchResult, RagState } from "@/types/embedding";

function extractErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === "string" && err.trim()) return err;
    if (err instanceof Error && err.message.trim()) return err.message;
    if (typeof err === "object" && err !== null && "message" in err) {
        const msg = String((err as { message?: unknown }).message ?? "").trim();
        if (msg) return msg;
    }
    return fallback;
}

export interface RagStore extends RagState {
    initializeRag: () => Promise<void>;

    // Indexing & Catalog
    loadCatalog: () => Promise<void>;
    indexDocument: (
        docId: string,
        docTitle: string,
        filePath: string,
        pageRanges?: [number, number][]
    ) => Promise<void>;
    removeDocumentIndex: (docId: string) => Promise<void>;

    // Chunks & Inspection
    setInspectChunksMode: (enabled: boolean) => void;
    inspectChunksForDocument: (docId: string) => Promise<void>;

    // RAG Search
    setRagQuery: (query: string) => void;
    setSearchScope: (scope: "current" | "all") => void;
    searchRag: (query?: string, docId?: string) => Promise<void>;
    setActiveRagHighlight: (result: RagSearchResult | null) => void;

    // Model Download & Deletion
    checkLocalModelStatus: () => Promise<void>;
    loadDownloadedModels: () => Promise<void>;
    downloadLocalModel: (modelId?: string) => Promise<void>;
    deleteLocalModel: (modelId?: string) => Promise<void>;
}

let ragInitPromise: Promise<void> | null = null;
let hasCompletedInitialSync = false;

export const useRagStore = create<RagStore>((set, get) => ({
    // Local Model Lifecycle
    localModelStatus: null,
    downloadProgress: null,
    isDownloadingModel: false,
    downloadedModels: [],
    isDeletingModel: false,

    // Indexing & Catalog
    isIndexing: false,
    indexingDocId: null,
    indexingProgress: 0,
    indexingProgressDetail: null,
    indexingError: null,
    catalog: { documents: [] },

    // Chunk Inspection
    isInspectChunksMode: false,
    inspectedChunks: [],
    isLoadingChunks: false,

    // RAG Search State
    ragQuery: "",
    ragResults: [],
    isSearchingRag: false,
    searchScope: "current",
    activeRagHighlight: null,

    initializeRag: () => {
        if (!ragInitPromise) {
            ragInitPromise = (async () => {
                try {
                    await useAiConfigStore.getState().initializeConfig();
                    hasCompletedInitialSync = true;
                    await Promise.all([
                        get().loadCatalog(),
                        get().checkLocalModelStatus(),
                        get().loadDownloadedModels(),
                    ]);
                } catch (err) {
                    console.warn("RagStore: Failed to initialize:", err);
                }
            })();
        }
        return ragInitPromise;
    },

    // =========================================================================
    // Indexing & Catalog
    // =========================================================================

    loadCatalog: async () => {
        try {
            const catalog = await RagService.getRagCatalog();
            set({ catalog });
        } catch (err) {
            console.warn("RagStore: Failed to load catalog:", err);
        }
    },

    indexDocument: async (docId, docTitle, filePath, pageRanges) => {
        set({
            isIndexing: true,
            indexingDocId: docId,
            indexingProgress: 0,
            indexingProgressDetail: null,
            indexingError: null,
        });

        const unlisten = await RagService.onIndexProgress((prog) => {
            if (prog.docId === docId) {
                set({
                    indexingProgress: prog.percent,
                    indexingProgressDetail: prog,
                });
            }
        });

        try {
            const config = useAiConfigStore.getState();
            await RagService.indexDocument(
                {
                    docId,
                    docTitle,
                    filePath,
                    selectedPageRanges: pageRanges,
                },
                config.hyperparameters,
                config.getActiveEmbeddingConfig()
            );

            const catalog = await RagService.getRagCatalog();
            set({
                catalog,
                isIndexing: false,
                indexingDocId: null,
                indexingProgress: 100,
                indexingProgressDetail: null,
            });

            await DocumentCatalogStorage.updateDocument(docId, { isIndexed: true }).catch(() => { });
            useDocumentStore.getState().setDocumentIndexed(true);
        } catch (err) {
            const message = extractErrorMessage(err, "Indexing failed.");
            console.error("RagStore: Indexing failed:", message);
            set({
                isIndexing: false,
                indexingDocId: null,
                indexingProgressDetail: null,
                indexingError: message,
            });
        } finally {
            unlisten();
        }
    },

    removeDocumentIndex: async (docId) => {
        try {
            await RagService.removeDocumentIndex(docId);
            const catalog = await RagService.getRagCatalog();
            set({ catalog, inspectedChunks: [], indexingError: null });
            await DocumentCatalogStorage.updateDocument(docId, { isIndexed: false }).catch(() => { });
            if (useDocumentStore.getState().activeDoc?.id === docId) {
                useDocumentStore.getState().setDocumentIndexed(false);
            }
        } catch (err) {
            console.error("RagStore: Remove index failed:", err);
        }
    },

    // =========================================================================
    // Chunks & Inspection
    // =========================================================================

    setInspectChunksMode: (enabled) => {
        set({ isInspectChunksMode: enabled });
    },

    inspectChunksForDocument: async (docId) => {
        set({ isLoadingChunks: true });
        try {
            const chunks = await RagService.getDocumentChunks(docId);
            set({ inspectedChunks: chunks, isLoadingChunks: false });
        } catch (err) {
            console.error("RagStore: Failed to fetch chunks:", err);
            set({ inspectedChunks: [], isLoadingChunks: false });
        }
    },

    // =========================================================================
    // RAG Search
    // =========================================================================

    setRagQuery: (query) => {
        set({ ragQuery: query });
    },

    setSearchScope: (scope) => {
        set({ searchScope: scope });
    },

    searchRag: async (query, docId) => {
        const q = query ?? get().ragQuery;
        if (!q || !q.trim()) {
            set({ ragResults: [], isSearchingRag: false });
            return;
        }

        set({ isSearchingRag: true, indexingError: null });
        try {
            const config = useAiConfigStore.getState();
            const results = await RagService.searchRag(
                {
                    query: q,
                    targetDocId: get().searchScope === "current" ? docId : undefined,
                    topK: config.hyperparameters.topK,
                    similarityThreshold: config.hyperparameters.similarityThreshold,
                },
                config.getActiveEmbeddingConfig()
            );
            set({ ragResults: results, isSearchingRag: false });
        } catch (err) {
            const message = extractErrorMessage(err, "RAG search failed.");
            console.error("RagStore: RAG search failed:", message);
            set({ ragResults: [], isSearchingRag: false, indexingError: message });
        }
    },

    setActiveRagHighlight: (result) => {
        set({ activeRagHighlight: result });
    },

    // =========================================================================
    // Local Model Lifecycle (Download & Deletion)
    // =========================================================================

    checkLocalModelStatus: async () => {
        try {
            const { embeddingProvider, embeddingModel } = useAiConfigStore.getState();
            const status = await RagService.getModelStatus(
                embeddingProvider,
                embeddingModel
            );
            set({ localModelStatus: status });
        } catch (err) {
            console.warn("RagStore: Failed to check model status:", err);
        }
    },

    loadDownloadedModels: async () => {
        try {
            const models = await RagService.listDownloadedModels();
            set({ downloadedModels: models });
        } catch (err) {
            console.warn("RagStore: Failed to list downloaded models:", err);
        }
    },

    downloadLocalModel: async (modelId) => {
        const targetModel = modelId ?? useAiConfigStore.getState().embeddingModel;
        set({
            isDownloadingModel: true,
            indexingError: null,
            downloadProgress: {
                modelId: targetModel,
                percent: 0,
                downloadedBytes: 0,
                totalBytes: 0,
                isComplete: false,
            },
        });

        const unlisten = await RagService.onModelDownloadProgress((prog) => {
            if (prog.modelId !== targetModel) return;
            set({ downloadProgress: prog });
            if (prog.isComplete) {
                set({ isDownloadingModel: false });
            }
        });

        try {
            await RagService.downloadModel(targetModel);
            await Promise.all([
                get().checkLocalModelStatus(),
                get().loadDownloadedModels(),
            ]);
            set({ isDownloadingModel: false });
        } catch (err) {
            const message = extractErrorMessage(err, "Model download failed");
            console.error("RagStore: Model download failed:", message);
            set({
                isDownloadingModel: false,
                downloadProgress: {
                    modelId: targetModel,
                    percent: 0,
                    downloadedBytes: 0,
                    totalBytes: 0,
                    isComplete: false,
                    error: message,
                },
            });
        } finally {
            unlisten();
        }
    },

    deleteLocalModel: async (modelId) => {
        const targetModel = modelId ?? useAiConfigStore.getState().embeddingModel;
        set({ isDeletingModel: true });
        try {
            await RagService.deleteModel(targetModel);
            await Promise.all([
                get().checkLocalModelStatus(),
                get().loadDownloadedModels(),
            ]);
        } catch (err) {
            const message = extractErrorMessage(err, "Failed to delete model.");
            console.error("RagStore: Failed to delete local model:", message);
            set({ indexingError: message });
        } finally {
            set({ isDeletingModel: false });
        }
    },
}));

// Keep local model status in sync when embedding provider/model changes
useAiConfigStore.subscribe((state, prevState) => {
    if (!hasCompletedInitialSync) return;
    if (
        state.embeddingProvider !== prevState.embeddingProvider ||
        state.embeddingModel !== prevState.embeddingModel
    ) {
        void useRagStore.getState().checkLocalModelStatus();
    }
});

void useRagStore.getState().initializeRag();