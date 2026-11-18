/**
 * Foliet - RAG Runtime Store
 */

import { create } from "zustand";
import { RagService } from "@/services/rag";
import { DocumentCatalogStorage } from "@/services/storage/catalog";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useLibraryStore } from "@/stores/libraryStore";
import type { RagSearchResult, RagState } from "@/types/embedding";
import { extractErrorMessage } from "@/utils/error";

export interface RagStore extends RagState {
    initializeRag: () => Promise<void>;
    loadCatalog: () => Promise<void>;
    indexDocument: (
        docId: string,
        docTitle: string,
        filePath: string,
        pageRanges?: [number, number][],
    ) => Promise<void>;
    removeDocumentIndex: (docId: string) => Promise<void>;
    inspectChunksForDocument: (docId: string) => Promise<void>;
    setRagQuery: (query: string) => void;
    setSearchScope: (scope: "current" | "all") => void;
    searchRag: (query?: string, docId?: string) => Promise<void>;
    setActiveRagHighlight: (result: RagSearchResult | null) => void;
    checkLocalModelStatus: () => Promise<void>;
    loadDownloadedModels: () => Promise<void>;
    downloadLocalModel: (modelId?: string) => Promise<void>;
    deleteLocalModel: (modelId?: string) => Promise<void>;
}

let ragInitPromise: Promise<void> | null = null;
let hasCompletedInitialSync = false;

export const useRagStore = create<RagStore>((set, get) => {
    const refreshLocalModels = () =>
        Promise.all([get().checkLocalModelStatus(), get().loadDownloadedModels()]);

    return {
        localModelStatus: null,
        downloadProgress: null,
        isDownloadingModel: false,
        downloadedModels: [],
        isDeletingModel: false,

        isIndexing: false,
        indexingDocId: null,
        indexingProgress: 0,
        indexingProgressDetail: null,
        indexingError: null,
        catalog: { documents: [] },

        inspectedChunks: [],
        isLoadingChunks: false,

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
                        await Promise.all([get().loadCatalog(), refreshLocalModels()]);
                    } catch (err) {
                        console.warn("RagStore: Failed to initialize:", err);
                    }
                })();
            }
            return ragInitPromise;
        },

        loadCatalog: async () => {
            try {
                set({ catalog: await RagService.getRagCatalog() });
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
                    set({ indexingProgress: prog.percent, indexingProgressDetail: prog });
                }
            });

            try {
                const config = useAiConfigStore.getState();
                await RagService.indexDocument(
                    { docId, docTitle, filePath, selectedPageRanges: pageRanges },
                    config.hyperparameters,
                    config.getActiveEmbeddingConfig(),
                );
                set({
                    catalog: await RagService.getRagCatalog(),
                    isIndexing: false,
                    indexingDocId: null,
                    indexingProgress: 100,
                    indexingProgressDetail: null,
                });
                await DocumentCatalogStorage.updateDocument(docId, {
                    isIndexed: true,
                }).catch(() => { });
                useLibraryStore.getState().updateDocumentInStore(docId, { isIndexed: true });
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
                set({
                    catalog: await RagService.getRagCatalog(),
                    inspectedChunks: [],
                    indexingError: null,
                });
                await DocumentCatalogStorage.updateDocument(docId, {
                    isIndexed: false,
                }).catch(() => { });
                useLibraryStore.getState().updateDocumentInStore(docId, { isIndexed: false });
                if (useDocumentStore.getState().activeDoc?.id === docId) {
                    useDocumentStore.getState().setDocumentIndexed(false);
                }
            } catch (err) {
                console.error("RagStore: Remove index failed:", err);
            }
        },

        inspectChunksForDocument: async (docId) => {
            set({ isLoadingChunks: true });
            try {
                set({
                    inspectedChunks: await RagService.getDocumentChunks(docId),
                    isLoadingChunks: false,
                });
            } catch (err) {
                console.error("RagStore: Failed to fetch chunks:", err);
                set({ inspectedChunks: [], isLoadingChunks: false });
            }
        },

        setRagQuery: (ragQuery) => set({ ragQuery }),
        setSearchScope: (searchScope) => set({ searchScope }),
        setActiveRagHighlight: (activeRagHighlight) => set({ activeRagHighlight }),

        searchRag: async (query, docId) => {
            const q = query ?? get().ragQuery;
            if (!q?.trim()) {
                set({ ragResults: [], isSearchingRag: false });
                return;
            }
            set({ isSearchingRag: true, indexingError: null });
            try {
                const config = useAiConfigStore.getState();
                const ragResults = await RagService.searchRag(
                    {
                        query: q,
                        targetDocId: get().searchScope === "current" ? docId : undefined,
                        topK: config.hyperparameters.topK,
                        similarityThreshold: config.hyperparameters.similarityThreshold,
                    },
                    config.getActiveEmbeddingConfig(),
                );
                set({ ragResults, isSearchingRag: false });
            } catch (err) {
                const message = extractErrorMessage(err, "RAG search failed.");
                console.error("RagStore: RAG search failed:", message);
                set({ ragResults: [], isSearchingRag: false, indexingError: message });
            }
        },

        checkLocalModelStatus: async () => {
            try {
                const { embeddingProvider, embeddingModel } = useAiConfigStore.getState();
                set({
                    localModelStatus: await RagService.getModelStatus(
                        embeddingProvider,
                        embeddingModel,
                    ),
                });
            } catch (err) {
                console.warn("RagStore: Failed to check model status:", err);
            }
        },

        loadDownloadedModels: async () => {
            try {
                set({ downloadedModels: await RagService.listDownloadedModels() });
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
                if (prog.isComplete) set({ isDownloadingModel: false });
            });

            try {
                await RagService.downloadModel(targetModel);
                await refreshLocalModels();
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
                await refreshLocalModels();
            } catch (err) {
                const message = extractErrorMessage(err, "Failed to delete model.");
                console.error("RagStore: Failed to delete local model:", message);
                set({ indexingError: message });
            } finally {
                set({ isDeletingModel: false });
            }
        },
    };
});

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