/**
 * Foliet - Persistent Chat & Streaming Store
 *
 * Manages SQLite-backed conversations, selection context handoff,
 * RAG-grounded prompt injection, and abortable LLM streaming.
 */

import { create } from "zustand";
import { LlmService } from "@/services/llm";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useRagStore } from "@/stores/ragStore";
import type {
    ChatConversation,
    ChatMessage,
    CitationReference,
} from "@/types/chat";

export interface ChatStore {
    conversations: ChatConversation[];
    activeConversationId: string | null;
    isStreaming: boolean;
    pendingContextSnippet: CitationReference | null;

    loadConversations: (docId?: string) => Promise<void>;
    setActiveConversationId: (id: string | null) => void;
    createConversation: (title?: string, docId?: string) => Promise<ChatConversation>;
    deleteConversation: (id: string) => Promise<void>;
    updateConversationTitle: (id: string, title: string) => Promise<void>;
    setPendingContextSnippet: (snippet: CitationReference | null) => void;

    sendMessage: (
        content: string,
        options?: { docId?: string; docTitle?: string; useRag?: boolean }
    ) => Promise<void>;
    cancelStreaming: () => void;
}

let activeAbortController: AbortController | null = null;

export const useChatStore = create<ChatStore>((set, get) => ({
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    pendingContextSnippet: null,

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
            console.warn("ChatStore: Failed to load conversations:", err);
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

    sendMessage: async (content, options) => {
        const text = content.trim();
        if (!text) return;

        if (get().isStreaming) {
            get().cancelStreaming();
        }

        const state = get();
        let conv = state.conversations.find((c) => c.id === state.activeConversationId);
        if (!conv) {
            const initialTitle = text.length > 36 ? `${text.slice(0, 36)}...` : text;
            conv = await get().createConversation(initialTitle, options?.docId);
        }

        const convId = conv.id;

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

        // RAG Semantic Search (passes active embeddingConfig into Rust)
        const aiConfig = useAiConfigStore.getState();
        const searchScope = useRagStore.getState().searchScope;
        let systemPrompt = "";
        let citations: CitationReference[] = [];
        const shouldSearchRag = options?.useRag ?? true;
        const targetDocId =
            searchScope === "current" ? options?.docId ?? convWithUser.docId : undefined;

        if (shouldSearchRag) {
            try {
                const ragResults = await RagService.searchRag(
                    {
                        query: text,
                        targetDocId,
                        topK: aiConfig.hyperparameters.topK,
                        similarityThreshold: aiConfig.hyperparameters.similarityThreshold,
                    },
                    aiConfig.getActiveEmbeddingConfig()
                );

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
                console.warn("ChatStore: RAG retrieval failed, proceeding without excerpts:", ragErr);
            }
        }

        // Create Assistant placeholder message
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

        // Stream LLM Completion
        let accumulatedText = "";
        try {
            const { llmProvider: provider, llmModel: model, apiKeys, ollamaEndpoint } =
                useAiConfigStore.getState();
            const apiKey = apiKeys[provider] ?? "";

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
}));