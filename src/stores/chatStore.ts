/**
 * Foliet - Persistent Chat & Streaming Store
 */

import { produce } from "immer";
import { create } from "zustand";
import { buildCopilotTools, LlmService } from "@/services/llm";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import type {
    ChatConversation,
    ChatMessage,
    CitationReference,
    ExecutedToolCall,
} from "@/types/chat";
import {
    formatStreamErrorOutput,
    formatUserPromptWithSelection,
} from "@/utils/llmFormatting";
import { readAnyRenderedPagesContext } from "@/utils/pdfDom";

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
    setViewerJumpHandler: (handler: ((page: number) => void) | null) => void;
    sendMessage: (
        content: string,
        options?: {
            docId?: string;
            docTitle?: string;
            useRag?: boolean;
            onNavigateToPage?: (page: number) => void;
        },
    ) => Promise<void>;
    cancelStreaming: () => void;
}

let activeAbortController: AbortController | null = null;
let registeredJumpHandler: ((page: number) => void) | null = null;

async function resolveChatSystemPrompt(params: {
    query: string;
    activeDocId?: string;
    activeDocTitle: string;
    isIndexed?: boolean;
    useRag: boolean;
}): Promise<{ systemPrompt: string; citations: CitationReference[] }> {
    const aiConfig = useAiConfigStore.getState();
    const targetDocId =
        useRagStore.getState().searchScope === "current"
            ? params.activeDocId
            : undefined;

    if (params.useRag) {
        try {
            const ragResults = await RagService.searchRag(
                {
                    query: params.query,
                    targetDocId,
                    topK: aiConfig.hyperparameters.topK,
                    similarityThreshold: aiConfig.hyperparameters.similarityThreshold,
                },
                aiConfig.getActiveEmbeddingConfig(),
            );
            if (ragResults.length > 0) {
                return {
                    systemPrompt: LlmService.buildRagSystemPrompt(
                        ragResults,
                        params.activeDocTitle,
                        true,
                    ),
                    citations: ragResults.map((r) => ({
                        chunkId: r.chunkId,
                        docId: r.docId,
                        docTitle: r.docTitle,
                        pageNumber: r.pageNumber,
                        snippet: r.text.slice(0, 200),
                    })),
                };
            }

            if (params.activeDocId) {
                const openingChunks = (
                    await RagService.getDocumentChunks(params.activeDocId).catch(() => [])
                ).slice(0, 5);
                if (openingChunks.length > 0) {
                    return {
                        systemPrompt: LlmService.buildRagSystemPrompt(
                            openingChunks.map((c) => ({
                                text: c.text,
                                pageNumber: c.pageNumber,
                                docTitle: params.activeDocTitle,
                            })),
                            params.activeDocTitle,
                            true,
                        ),
                        citations: openingChunks.map((c) => ({
                            chunkId: c.chunkId,
                            docId: params.activeDocId!,
                            docTitle: params.activeDocTitle,
                            pageNumber: c.pageNumber,
                            snippet: c.text.slice(0, 200),
                        })),
                    };
                }
            }
        } catch (ragErr) {
            console.warn("ChatStore: RAG retrieval failed, using fallback context:", ragErr);
        }
    }

    const renderedPages = readAnyRenderedPagesContext();
    if (renderedPages.length > 0) {
        return {
            systemPrompt: LlmService.buildRagSystemPrompt(
                renderedPages.map((p) => ({
                    text: p.text,
                    pageNumber: p.pageNumber,
                    docTitle: params.activeDocTitle,
                })),
                params.activeDocTitle,
                true,
            ),
            citations: [],
        };
    }

    const fallbackHint = params.isIndexed
        ? "You can call `navigate_to`, `highlight_passage`, `explain_figure`, or `add_figure_to_summary` to inspect, cite, and capture pages."
        : "Note: This PDF has not been indexed in RAG Search yet, and no page text is currently loaded. You may call `navigate_to(pageNumber: 1)` to jump to and read a page, or remind the user to click 'Index Document' in the RAG Search tab for full-book semantic search.";

    return {
        systemPrompt: `You are Foliet's scholarly research assistant (Lio). The user has "${params.activeDocTitle}" open in the PDF viewer. ${fallbackHint}`,
        citations: [],
    };
}

export const useChatStore = create<ChatStore>((set, get) => ({
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    pendingContextSnippet: null,

    loadConversations: async (docId) => {
        try {
            const conversations = await DocumentDatabase.getConversations(docId);
            set((state) => ({
                conversations,
                activeConversationId: conversations.some(
                    (c) => c.id === state.activeConversationId,
                )
                    ? state.activeConversationId
                    : (conversations[0]?.id ?? null),
            }));
        } catch (err) {
            console.warn("ChatStore: Failed to load conversations:", err);
        }
    },

    setActiveConversationId: (activeConversationId) => set({ activeConversationId }),

    createConversation: async (title = "New Chat", docId) => {
        const now = Date.now();
        const newConv: ChatConversation = {
            id: crypto.randomUUID(),
            docId,
            title,
            createdAt: now,
            updatedAt: now,
            messages: [],
        };
        set((s) => ({
            conversations: [newConv, ...s.conversations],
            activeConversationId: newConv.id,
        }));
        await DocumentDatabase.saveConversation(newConv);
        return newConv;
    },

    deleteConversation: async (id) => {
        await DocumentDatabase.deleteConversation(id);
        set((s) => {
            const conversations = s.conversations.filter((c) => c.id !== id);
            return {
                conversations,
                activeConversationId:
                    s.activeConversationId === id
                        ? (conversations[0]?.id ?? null)
                        : s.activeConversationId,
            };
        });
    },

    updateConversationTitle: async (id, title) => {
        const target = get().conversations.find((c) => c.id === id);
        if (!target) return;
        const updated: ChatConversation = { ...target, title, updatedAt: Date.now() };
        set((s) => ({
            conversations: s.conversations.map((c) => (c.id === id ? updated : c)),
        }));
        await DocumentDatabase.saveConversation(updated);
    },

    setPendingContextSnippet: (pendingContextSnippet) => set({ pendingContextSnippet }),
    setViewerJumpHandler: (handler) => {
        registeredJumpHandler = handler;
    },

    sendMessage: async (content, options) => {
        const text = content.trim();
        if (!text) return;
        if (get().isStreaming) get().cancelStreaming();

        let conv = get().conversations.find((c) => c.id === get().activeConversationId);
        if (!conv) {
            const title = text.length > 36 ? `${text.slice(0, 36)}...` : text;
            conv = await get().createConversation(title, options?.docId);
        }

        const convId = conv.id;
        const activeDoc = useDocumentStore.getState().activeDoc;
        const activeDocId = options?.docId ?? conv.docId ?? activeDoc?.id;
        const activeDocTitle = options?.docTitle ?? activeDoc?.title ?? "Current Document";
        const jumpToPage = options?.onNavigateToPage ?? registeredJumpHandler ?? undefined;

        const pendingSnippet = get().pendingContextSnippet;
        const userMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: formatUserPromptWithSelection(text, pendingSnippet),
            timestamp: Date.now(),
            citations: pendingSnippet ? [pendingSnippet] : undefined,
        };

        set((s) =>
            produce(s, (draft) => {
                draft.pendingContextSnippet = null;
                const target = draft.conversations.find((c) => c.id === convId);
                if (target) {
                    target.updatedAt = Date.now();
                    target.messages.push(userMsg);
                }
            }),
        );
        const convAfterUser = get().conversations.find((c) => c.id === convId);
        if (convAfterUser) await DocumentDatabase.saveConversation(convAfterUser);

        const { systemPrompt, citations } = await resolveChatSystemPrompt({
            query: text,
            activeDocId,
            activeDocTitle,
            isIndexed: activeDoc?.isIndexed,
            useRag: options?.useRag ?? true,
        });

        const assistantId = crypto.randomUUID();
        const abortController = new AbortController();
        activeAbortController = abortController;

        set((s) =>
            produce(s, (draft) => {
                draft.isStreaming = true;
                const target = draft.conversations.find((c) => c.id === convId);
                if (target) {
                    target.updatedAt = Date.now();
                    target.messages.push({
                        id: assistantId,
                        role: "assistant",
                        content: "",
                        timestamp: Date.now(),
                        citations: citations.length > 0 ? citations : undefined,
                        isStreaming: true,
                    });
                }
            }),
        );

        let accumulatedText = "";
        const allExecutedTools: ExecutedToolCall[] = [];

        const patchAssistant = (patch: Partial<ChatMessage>, isFinal = false) => {
            set((s) =>
                produce(s, (draft) => {
                    if (isFinal) draft.isStreaming = false;
                    const target = draft.conversations.find((c) => c.id === convId);
                    const msg = target?.messages.find((m) => m.id === assistantId);
                    if (target && msg) {
                        if (isFinal) target.updatedAt = Date.now();
                        Object.assign(msg, patch);
                    }
                }),
            );
        };

        const finalizeMessage = async (finalContent: string) => {
            patchAssistant(
                {
                    isStreaming: false,
                    content: finalContent,
                    toolCalls:
                        allExecutedTools.length > 0 ? [...allExecutedTools] : undefined,
                },
                true,
            );
            const finalConv = get().conversations.find((c) => c.id === convId);
            if (finalConv) await DocumentDatabase.saveConversation(finalConv);
        };

        try {
            const aiConfig = useAiConfigStore.getState();
            const historyBeforeAssistant =
                convAfterUser?.messages ?? [...conv.messages, userMsg];

            await LlmService.streamChat({
                messages: historyBeforeAssistant,
                systemPrompt: systemPrompt || undefined,
                ...aiConfig.getActiveLlmConfig(),
                webSearchEnabled: aiConfig.webSearchEnabled,
                tools: buildCopilotTools(
                    { docId: activeDocId, docTitle: activeDocTitle, jumpToPage },
                    (executed) => {
                        allExecutedTools.push(executed);
                        patchAssistant({ toolCalls: [...allExecutedTools] });
                    },
                ),
                maxSteps: 3,
                signal: abortController.signal,
                onChunk: (chunk) => {
                    accumulatedText += chunk;
                    patchAssistant({ content: accumulatedText });
                },
            });

            await finalizeMessage(accumulatedText);
        } catch (err) {
            await finalizeMessage(
                formatStreamErrorOutput(accumulatedText, err, abortController.signal),
            );
        } finally {
            if (activeAbortController === abortController) {
                activeAbortController = null;
            }
        }
    },

    cancelStreaming: () => {
        activeAbortController?.abort();
        activeAbortController = null;
        set({ isStreaming: false });
    },
}));