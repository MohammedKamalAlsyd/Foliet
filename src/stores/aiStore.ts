/**
 * Foliet - Zustand AI Store
 *
 * Implements global AI state combining conversational LLM streaming,
 * SQLite persistence, dense vector indexing, chunk inspection,
 * and RAG semantic retrieval.
 */

import { create } from "zustand";
import { SettingsStorage } from "@/services/storage/settings";
import { DocumentDatabase } from "@/services/storage/database";
import { LlmService } from "@/services/llm";
import { RagService } from "@/services/rag";
import { useDocumentStore } from "@/stores/documentStore";
import {
    DEFAULT_AI_SETTINGS,
    DEFAULT_RAG_HYPERPARAMETERS,
    LLM_PRESETS,
    EMBEDDING_PRESETS,
} from "@/constants/models";
import type {
    LlmProvider,
    ChatConversation,
    ChatMessage,
    CitationReference,
    AiConfigState,
} from "@/types/chat";
import type {
    EmbeddingProvider,
    RagSearchResult,
    RagHyperparameters,
} from "@/types/embedding";

export interface AiSummaryState {
    content: string;
    sourceSnapshot?: string;
    updatedAt: number;
}

export interface AiStore extends AiConfigState {
    // Conversation State
    conversations: ChatConversation[];
    activeConversationId: string | null;
    isStreaming: boolean;
    pendingContextSnippet: CitationReference | null;

    // Document Summary State
    activeSummary: AiSummaryState | null;
    isLoadingSummary: boolean;
    isSummarizing: boolean;

    // Actions - Init & Settings
    initializeAiStore: () => Promise<void>;
    setLlmProvider: (provider: LlmProvider) => Promise<void>;
    setLlmModel: (model: string) => Promise<void>;
    setApiKey: (provider: LlmProvider, key: string) => Promise<void>;
    setOllamaEndpoint: (endpoint: string) => Promise<void>;
    setEmbeddingProvider: (provider: EmbeddingProvider) => Promise<void>;
    setEmbeddingModel: (model: string) => Promise<void>;
    setEmbeddingApiKey: (key: string) => Promise<void>;
    setHyperparameters: (patch: Partial<RagHyperparameters>) => Promise<void>;
    resetToDefaults: () => Promise<void>;

    // Actions - Conversations
    loadConversations: (docId?: string) => Promise<void>;
    setActiveConversationId: (id: string | null) => void;
    createConversation: (title?: string, docId?: string) => Promise<ChatConversation>;
    deleteConversation: (id: string) => Promise<void>;
    updateConversationTitle: (id: string, title: string) => Promise<void>;
    setPendingContextSnippet: (snippet: CitationReference | null) => void;

    // Actions - Messaging & Streaming
    sendMessage: (
        content: string,
        options?: { docId?: string; docTitle?: string; useRag?: boolean }
    ) => Promise<void>;
    cancelStreaming: () => void;

    // Actions - Summaries
    loadSummary: (docId: string) => Promise<void>;
    generateSummary: (docId: string, docTitle: string, fullTextOrExcerpt: string) => Promise<void>;
    deleteSummary: (docId: string) => Promise<void>;

    // Actions - Indexing & Catalog
    loadCatalog: () => Promise<void>;
    indexDocument: (
        docId: string,
        docTitle: string,
        filePath: string,
        pageRanges?: [number, number][]
    ) => Promise<void>;
    removeDocumentIndex: (docId: string) => Promise<void>;

    // Actions - Chunks & Inspection
    setInspectChunksMode: (enabled: boolean) => void;
    inspectChunksForDocument: (docId: string) => Promise<void>;

    // Actions - RAG Search
    setRagQuery: (query: string) => void;
    setSearchScope: (scope: "current" | "all") => void;
    searchRag: (query?: string, docId?: string) => Promise<void>;
    setActiveRagHighlight: (result: RagSearchResult | null) => void;

    // Actions - Model Download
    checkLocalModelStatus: () => Promise<void>;
    downloadLocalModel: (modelId?: string) => Promise<void>;

    // AI Studio UI State & Selection
    isAiStudioOpen: boolean;
    activeAiTab: "chat" | "search" | "chunks" | "summary" | "settings";
    setAiStudioOpen: (open: boolean) => void;
    toggleAiStudio: () => void;
    setActiveAiTab: (tab: "chat" | "search" | "chunks" | "summary" | "settings") => void;
    askAboutSelection: (selection: {
        text: string;
        pageNumber: number;
        docTitle?: string;
        docId?: string;
    }) => void;
}

const DEFAULT_API_KEYS: Record<LlmProvider, string> = {
    openrouter: "",
    "google-ai-studio": "",
    ollama: "",
    openai: "",
    anthropic: "",
};

// Module-scoped abort controller for currently active chat completion stream
let activeAbortController: AbortController | null = null;

export const useAiStore = create<AiStore>((set, get) => ({
    // LLM Config
    llmProvider: DEFAULT_AI_SETTINGS.llmProvider,
    llmModel: DEFAULT_AI_SETTINGS.llmModel,
    apiKeys: { ...DEFAULT_API_KEYS },
    ollamaEndpoint: DEFAULT_AI_SETTINGS.ollamaEndpoint,

    // Embedding Config
    embeddingProvider: DEFAULT_AI_SETTINGS.embeddingProvider,
    embeddingModel: DEFAULT_AI_SETTINGS.embeddingModel,
    embeddingApiKey: DEFAULT_AI_SETTINGS.embeddingApiKey,

    // Local Model Lifecycle
    localModelStatus: null,
    downloadProgress: null,
    isDownloadingModel: false,

    // Indexing & Catalog
    isIndexing: false,
    indexingDocId: null,
    indexingProgress: 0,
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

    // Hyperparameters
    hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },

    // Conversation State
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    pendingContextSnippet: null,

    // Document Summary State
    activeSummary: null,
    isLoadingSummary: false,
    isSummarizing: false,

    // AI Studio UI State
    isAiStudioOpen: false,
    activeAiTab: "chat",

    // =========================================================================
    // Initialization & Settings
    // =========================================================================

    initializeAiStore: async () => {
        try {
            const saved = await SettingsStorage.getAiSettings();
            const mergedKeys: Record<LlmProvider, string> = {
                openrouter: saved.apiKeys.openrouter ?? "",
                "google-ai-studio": saved.apiKeys["google-ai-studio"] ?? "",
                ollama: saved.apiKeys.ollama ?? "",
                openai: saved.apiKeys.openai ?? "",
                anthropic: saved.apiKeys.anthropic ?? "",
            };

            set({
                llmProvider: saved.llmProvider,
                llmModel: saved.llmModel,
                apiKeys: mergedKeys,
                ollamaEndpoint: saved.ollamaEndpoint,
                embeddingProvider: saved.embeddingProvider,
                embeddingModel: saved.embeddingModel,
                embeddingApiKey: saved.embeddingApiKey,
                hyperparameters: { ...saved.hyperparameters },
            });

            // Load catalog and check local embedding model status
            const catalog = await RagService.getRagCatalog();
            set({ catalog });

            await get().checkLocalModelStatus();
        } catch (err) {
            console.warn("AiStore: Failed to initialize settings:", err);
        }
    },

    setLlmProvider: async (provider) => {
        const presets = LLM_PRESETS[provider];
        const defaultModel = presets?.find((p) => p.isDefault)?.id ?? presets?.[0]?.id ?? get().llmModel;
        set({
            llmProvider: provider,
            llmModel: defaultModel,
        });
        await SettingsStorage.saveAiSettings({
            llmProvider: provider,
            llmModel: defaultModel,
        });
    },

    setLlmModel: async (model) => {
        set({ llmModel: model });
        await SettingsStorage.saveAiSettings({ llmModel: model });
    },

    setApiKey: async (provider, key) => {
        const nextKeys = { ...get().apiKeys, [provider]: key };
        set({ apiKeys: nextKeys });
        await SettingsStorage.saveAiSettings({ apiKeys: nextKeys });
    },

    setOllamaEndpoint: async (endpoint) => {
        set({ ollamaEndpoint: endpoint });
        await SettingsStorage.saveAiSettings({ ollamaEndpoint: endpoint });
    },

    setEmbeddingProvider: async (provider) => {
        const presets = EMBEDDING_PRESETS[provider];
        const defaultModel =
            presets?.find((p) => p.isDefault)?.id ?? presets?.[0]?.id ?? get().embeddingModel;
        set({
            embeddingProvider: provider,
            embeddingModel: defaultModel,
        });
        await SettingsStorage.saveAiSettings({
            embeddingProvider: provider,
            embeddingModel: defaultModel,
        });
        await get().checkLocalModelStatus();
    },

    setEmbeddingModel: async (model) => {
        set({ embeddingModel: model });
        await SettingsStorage.saveAiSettings({ embeddingModel: model });
        await get().checkLocalModelStatus();
    },

    setEmbeddingApiKey: async (key) => {
        set({ embeddingApiKey: key });
        await SettingsStorage.saveAiSettings({ embeddingApiKey: key });
    },

    setHyperparameters: async (patch) => {
        const next = { ...get().hyperparameters, ...patch };
        set({ hyperparameters: next });
        await SettingsStorage.saveAiSettings({ hyperparameters: next });
    },

    resetToDefaults: async () => {
        const defaults = await SettingsStorage.resetAiSettings();
        set({
            llmProvider: defaults.llmProvider,
            llmModel: defaults.llmModel,
            apiKeys: { ...DEFAULT_API_KEYS },
            ollamaEndpoint: defaults.ollamaEndpoint,
            embeddingProvider: defaults.embeddingProvider,
            embeddingModel: defaults.embeddingModel,
            embeddingApiKey: defaults.embeddingApiKey,
            hyperparameters: { ...defaults.hyperparameters },
        });
        await get().checkLocalModelStatus();
    },

    // =========================================================================
    // Conversations Management
    // =========================================================================

    loadConversations: async (docId?: string) => {
        try {
            const conversations = await DocumentDatabase.getConversations(docId);
            set((state) => {
                const currentActiveExists = conversations.some(
                    (c) => c.id === state.activeConversationId
                );
                return {
                    conversations,
                    activeConversationId: currentActiveExists
                        ? state.activeConversationId
                        : conversations[0]?.id ?? null,
                };
            });
        } catch (err) {
            console.warn("AiStore: Failed to load conversations:", err);
        }
    },

    setActiveConversationId: (id) => {
        set({ activeConversationId: id });
    },

    createConversation: async (title = "New Chat", docId?: string) => {
        const newConv: ChatConversation = {
            id: crypto.randomUUID(),
            docId,
            title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
        };
        set((state) => ({
            conversations: [newConv, ...state.conversations],
            activeConversationId: newConv.id,
        }));
        await DocumentDatabase.saveConversation(newConv);
        return newConv;
    },

    deleteConversation: async (id) => {
        await DocumentDatabase.deleteConversation(id);
        set((state) => {
            const nextConversations = state.conversations.filter((c) => c.id !== id);
            let nextActiveId = state.activeConversationId;
            if (state.activeConversationId === id) {
                nextActiveId = nextConversations[0]?.id ?? null;
            }
            return {
                conversations: nextConversations,
                activeConversationId: nextActiveId,
            };
        });
    },

    updateConversationTitle: async (id, title) => {
        const target = get().conversations.find((c) => c.id === id);
        if (!target) return;
        const updated: ChatConversation = {
            ...target,
            title,
            updatedAt: Date.now(),
        };
        set((state) => ({
            conversations: state.conversations.map((c) => (c.id === id ? updated : c)),
        }));
        await DocumentDatabase.saveConversation(updated);
    },

    setPendingContextSnippet: (snippet) => {
        set({ pendingContextSnippet: snippet });
    },

    // =========================================================================
    // Messaging & Streaming
    // =========================================================================

    sendMessage: async (content, options) => {
        const text = content.trim();
        if (!text) return;

        // Cancel any pending active stream
        if (get().isStreaming) {
            get().cancelStreaming();
        }

        // 1. Resolve or create active conversation
        let state = get();
        let conv = state.conversations.find((c) => c.id === state.activeConversationId);
        if (!conv) {
            const initialTitle = text.length > 36 ? `${text.slice(0, 36)}...` : text;
            conv = await get().createConversation(initialTitle, options?.docId);
        }

        const convId = conv.id;

        // 2. Build User message & clear pending snippet
        const pendingSnippet = get().pendingContextSnippet;
        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: text,
            timestamp: Date.now(),
            citations: pendingSnippet ? [pendingSnippet] : undefined,
        };
        set({ pendingContextSnippet: null });

        const messagesWithUser = [...conv.messages, userMsg];
        const convWithUser: ChatConversation = {
            ...conv,
            updatedAt: Date.now(),
            messages: messagesWithUser,
        };

        set((s) => ({
            conversations: s.conversations.map((c) => (c.id === convId ? convWithUser : c)),
        }));
        await DocumentDatabase.saveConversation(convWithUser);

        // 3. RAG Semantic Search (if enabled)
        let systemPrompt = "";
        let citations: CitationReference[] = [];
        const shouldSearchRag = options?.useRag ?? true;
        const targetDocId =
            get().searchScope === "current" ? options?.docId ?? convWithUser.docId : undefined;

        if (shouldSearchRag) {
            try {
                const ragResults = await RagService.searchRag({
                    query: text,
                    targetDocId,
                    topK: get().hyperparameters.topK,
                    similarityThreshold: get().hyperparameters.similarityThreshold,
                });

                if (ragResults.length > 0) {
                    citations = ragResults.map((r) => ({
                        chunkId: r.chunkId,
                        docId: r.docId,
                        docTitle: r.docTitle,
                        pageNumber: r.pageNumber,
                        snippet: r.text.slice(0, 200),
                    }));
                    systemPrompt = LlmService.buildRagSystemPrompt(
                        ragResults,
                        options?.docTitle
                    );
                }
            } catch (ragErr) {
                console.warn("AiStore: RAG retrieval failed, proceeding without excerpts:", ragErr);
            }
        }

        // 4. Create Assistant placeholder message
        const assistantId = crypto.randomUUID();
        const assistantPlaceholder: ChatMessage = {
            id: assistantId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            citations: citations.length > 0 ? citations : undefined,
            isStreaming: true,
        };

        const messagesWithAssistant = [...messagesWithUser, assistantPlaceholder];
        const convWithAssistant: ChatConversation = {
            ...convWithUser,
            updatedAt: Date.now(),
            messages: messagesWithAssistant,
        };

        const abortController = new AbortController();
        activeAbortController = abortController;

        set((s) => ({
            isStreaming: true,
            conversations: s.conversations.map((c) => (c.id === convId ? convWithAssistant : c)),
        }));

        // 5. Stream LLM Completion
        let accumulatedText = "";
        try {
            const provider = get().llmProvider;
            const model = get().llmModel;
            const apiKey = get().apiKeys[provider] ?? "";
            const ollamaEndpoint = get().ollamaEndpoint;

            await LlmService.streamChat({
                messages: messagesWithUser,
                systemPrompt: systemPrompt || undefined,
                provider,
                model,
                apiKey,
                ollamaEndpoint,
                signal: abortController.signal,
                onChunk: (chunk) => {
                    accumulatedText += chunk;
                    set((s) => ({
                        conversations: s.conversations.map((c) => {
                            if (c.id !== convId) return c;
                            return {
                                ...c,
                                messages: c.messages.map((m) =>
                                    m.id === assistantId ? { ...m, content: accumulatedText } : m
                                ),
                            };
                        }),
                    }));
                },
            });

            // Completion successful
            const finalConv: ChatConversation = {
                ...convWithAssistant,
                updatedAt: Date.now(),
                messages: convWithAssistant.messages.map((m) =>
                    m.id === assistantId
                        ? { ...m, isStreaming: false, content: accumulatedText }
                        : m
                ),
            };

            set((s) => ({
                isStreaming: false,
                conversations: s.conversations.map((c) => (c.id === convId ? finalConv : c)),
            }));
            await DocumentDatabase.saveConversation(finalConv);
        } catch (err: any) {
            const isAborted = err?.name === "AbortError" || abortController.signal.aborted;
            const finalContent = isAborted
                ? accumulatedText
                : accumulatedText.length > 0
                ? `${accumulatedText}\n\n[Generation stopped: ${err?.message || "Unknown error"}]`
                : `[Error: ${err?.message || "Generation failed"}]`;

            const finalConv: ChatConversation = {
                ...convWithAssistant,
                updatedAt: Date.now(),
                messages: convWithAssistant.messages.map((m) =>
                    m.id === assistantId
                        ? { ...m, isStreaming: false, content: finalContent }
                        : m
                ),
            };

            set((s) => ({
                isStreaming: false,
                conversations: s.conversations.map((c) => (c.id === convId ? finalConv : c)),
            }));
            await DocumentDatabase.saveConversation(finalConv);
        } finally {
            if (activeAbortController === abortController) {
                activeAbortController = null;
            }
        }
    },

    cancelStreaming: () => {
        if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
        }
        set({ isStreaming: false });
    },

    // =========================================================================
    // Document Summaries
    // =========================================================================

    loadSummary: async (docId) => {
        set({ isLoadingSummary: true });
        try {
            const summary = await DocumentDatabase.getSummary(docId);
            set({ activeSummary: summary, isLoadingSummary: false });
        } catch (err) {
            console.warn("AiStore: Failed to load summary:", err);
            set({ activeSummary: null, isLoadingSummary: false });
        }
    },

    generateSummary: async (docId, docTitle, fullTextOrExcerpt) => {
        set({ isSummarizing: true });
        try {
            const prompt = LlmService.buildSummarizationPrompt(docTitle, fullTextOrExcerpt);
            const provider = get().llmProvider;
            const model = get().llmModel;
            const apiKey = get().apiKeys[provider] ?? "";
            const ollamaEndpoint = get().ollamaEndpoint;

            let accumulated = "";
            await LlmService.streamChat({
                messages: [
                    {
                        id: crypto.randomUUID(),
                        role: "user",
                        content: prompt,
                        timestamp: Date.now(),
                    },
                ],
                provider,
                model,
                apiKey,
                ollamaEndpoint,
                onChunk: (chunk) => {
                    accumulated += chunk;
                    set({
                        activeSummary: {
                            content: accumulated,
                            sourceSnapshot: docTitle,
                            updatedAt: Date.now(),
                        },
                    });
                },
            });

            await DocumentDatabase.saveSummary(docId, accumulated, docTitle);
            set({
                isSummarizing: false,
                activeSummary: {
                    content: accumulated,
                    sourceSnapshot: docTitle,
                    updatedAt: Date.now(),
                },
            });
        } catch (err: any) {
            console.error("AiStore: Summarization failed:", err);
            set({ isSummarizing: false });
            throw err;
        }
    },

    deleteSummary: async (docId) => {
        await DocumentDatabase.deleteSummary(docId);
        set({ activeSummary: null });
    },

    // =========================================================================
    // Indexing & Catalog
    // =========================================================================

    loadCatalog: async () => {
        try {
            const catalog = await RagService.getRagCatalog();
            set({ catalog });
        } catch (err) {
            console.warn("AiStore: Failed to load catalog:", err);
        }
    },

    indexDocument: async (docId, docTitle, filePath, pageRanges) => {
        set({
            isIndexing: true,
            indexingDocId: docId,
            indexingProgress: 0,
            indexingError: null,
        });

        try {
            await RagService.indexDocument(
                {
                    docId,
                    docTitle,
                    filePath,
                    selectedPageRanges: pageRanges,
                },
                get().hyperparameters
            );

            const catalog = await RagService.getRagCatalog();
            set({
                catalog,
                isIndexing: false,
                indexingDocId: null,
                indexingProgress: 100,
            });

            // Sync with document store
            useDocumentStore.getState().setDocumentIndexed(true);
        } catch (err: any) {
            console.error("AiStore: Indexing failed:", err);
            set({
                isIndexing: false,
                indexingDocId: null,
                indexingError: err?.message || "Indexing failed.",
            });
        }
    },

    removeDocumentIndex: async (docId) => {
        try {
            await RagService.removeDocumentIndex(docId);
            const catalog = await RagService.getRagCatalog();
            set({ catalog });
            useDocumentStore.getState().setDocumentIndexed(false);
        } catch (err) {
            console.error("AiStore: Remove index failed:", err);
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
            console.error("AiStore: Failed to fetch chunks:", err);
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

        set({ isSearchingRag: true });
        try {
            const results = await RagService.searchRag({
                query: q,
                targetDocId: get().searchScope === "current" ? docId : undefined,
                topK: get().hyperparameters.topK,
                similarityThreshold: get().hyperparameters.similarityThreshold,
            });
            set({ ragResults: results, isSearchingRag: false });
        } catch (err) {
            console.error("AiStore: RAG search failed:", err);
            set({ ragResults: [], isSearchingRag: false });
        }
    },

    setActiveRagHighlight: (result) => {
        set({ activeRagHighlight: result });
    },

    // =========================================================================
    // Local Model Lifecycle
    // =========================================================================

    checkLocalModelStatus: async () => {
        try {
            const status = await RagService.getModelStatus(
                get().embeddingProvider,
                get().embeddingModel
            );
            set({ localModelStatus: status });
        } catch (err) {
            console.warn("AiStore: Failed to check model status:", err);
        }
    },

    downloadLocalModel: async (modelId) => {
        const targetModel = modelId ?? get().embeddingModel;
        set({
            isDownloadingModel: true,
            downloadProgress: {
                modelId: targetModel,
                percent: 0,
                downloadedBytes: 0,
                totalBytes: 0,
                isComplete: false,
            },
        });

        const unlisten = await RagService.onModelDownloadProgress((prog) => {
            set({ downloadProgress: prog });
            if (prog.isComplete) {
                set({ isDownloadingModel: false });
                get().checkLocalModelStatus();
            }
        });

        try {
            await RagService.downloadModel(targetModel);
            await get().checkLocalModelStatus();
        } catch (err: any) {
            console.error("AiStore: Model download failed:", err);
            set({
                isDownloadingModel: false,
                downloadProgress: {
                    modelId: targetModel,
                    percent: 0,
                    downloadedBytes: 0,
                    totalBytes: 0,
                    isComplete: false,
                    error: err?.message || "Model download failed",
                },
            });
        } finally {
            unlisten();
        }
    },

    // =========================================================================
    // AI Studio UI Actions
    // =========================================================================

    setAiStudioOpen: (open) => {
        set({ isAiStudioOpen: open });
    },

    toggleAiStudio: () => {
        set((state) => ({ isAiStudioOpen: !state.isAiStudioOpen }));
    },

    setActiveAiTab: (tab) => {
        set({ activeAiTab: tab });
    },

    askAboutSelection: ({ text, pageNumber, docTitle, docId }) => {
        const citation: CitationReference = {
            chunkId: `selection-${Date.now()}`,
            docId: docId ?? "",
            docTitle: docTitle ?? "Document",
            pageNumber,
            snippet: text.trim(),
        };
        set({
            pendingContextSnippet: citation,
            isAiStudioOpen: true,
            activeAiTab: "chat",
        });
    },
}));

// Automatically initialize AI store settings on startup
useAiStore.getState().initializeAiStore();
