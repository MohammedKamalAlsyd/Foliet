/**
 * Foliet - Persistent Chat & Streaming Store
 */

import { create } from "zustand";
import {
    FOLIET_TOOL_DEFINITIONS,
    LlmService,
    type LlmToolCall,
} from "@/services/llm";
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
import { executeCopilotToolCall } from "@/utils/chatTools";
import { isAbortError } from "@/utils/error";
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
    const searchScope = useRagStore.getState().searchScope;
    const targetDocId = searchScope === "current" ? params.activeDocId : undefined;
    let citations: CitationReference[] = [];

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
                citations = ragResults.map((r) => ({
                    chunkId: r.chunkId,
                    docId: r.docId,
                    docTitle: r.docTitle,
                    pageNumber: r.pageNumber,
                    snippet: r.text.slice(0, 200),
                }));
                return {
                    systemPrompt: LlmService.buildRagSystemPrompt(
                        ragResults,
                        params.activeDocTitle,
                        true,
                    ),
                    citations,
                };
            }

            if (params.activeDocId) {
                const openingChunks = (
                    await RagService.getDocumentChunks(params.activeDocId).catch(() => [])
                ).slice(0, 5);
                if (openingChunks.length > 0) {
                    citations = openingChunks.map((c) => ({
                        chunkId: c.chunkId,
                        docId: params.activeDocId!,
                        docTitle: params.activeDocTitle,
                        pageNumber: c.pageNumber,
                        snippet: c.text.slice(0, 200),
                    }));
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
                        citations,
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
            citations,
        };
    }

    const fallbackHint = params.isIndexed
        ? "You can call `navigate_to`, `highlight_passage`, `explain_figure`, or `add_figure_to_summary` to inspect, cite, and capture pages."
        : "Note: This PDF has not been indexed in RAG Search yet, and no page text is currently loaded. You may call `navigate_to(pageNumber: 1)` to jump to and read a page, or remind the user to click 'Index Document' in the RAG Search tab for full-book semantic search.";

    return {
        systemPrompt: `You are Foliet's scholarly research assistant (Lio). The user has "${params.activeDocTitle}" open in the PDF viewer. ${fallbackHint}`,
        citations,
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

        const state = get();
        let conv = state.conversations.find((c) => c.id === state.activeConversationId);
        if (!conv) {
            const initialTitle = text.length > 36 ? `${text.slice(0, 36)}...` : text;
            conv = await get().createConversation(initialTitle, options?.docId);
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
            content: pendingSnippet
                ? `[Selected from Page ${pendingSnippet.pageNumber}: "${pendingSnippet.snippet}"]\n\n${text}`
                : text,
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

        const { systemPrompt, citations } = await resolveChatSystemPrompt({
            query: text,
            activeDocId,
            activeDocTitle,
            isIndexed: activeDoc?.isIndexed,
            useRag: options?.useRag ?? true,
        });

        const assistantId = crypto.randomUUID();
        const convWithAssistant: ChatConversation = {
            ...convWithUser,
            updatedAt: Date.now(),
            messages: [
                ...messagesWithUser,
                {
                    id: assistantId,
                    role: "assistant",
                    content: "",
                    timestamp: Date.now(),
                    citations: citations.length > 0 ? citations : undefined,
                    isStreaming: true,
                },
            ],
        };

        const abortController = new AbortController();
        activeAbortController = abortController;

        set((s) => ({
            isStreaming: true,
            conversations: s.conversations.map((c) =>
                c.id === convId ? convWithAssistant : c,
            ),
        }));

        let accumulatedText = "";
        const allExecutedTools: ExecutedToolCall[] = [];

        const patchAssistant = (patch: Partial<ChatMessage>) => {
            set((s) => ({
                conversations: s.conversations.map((c) =>
                    c.id === convId
                        ? {
                            ...c,
                            messages: c.messages.map((m) =>
                                m.id === assistantId ? { ...m, ...patch } : m,
                            ),
                        }
                        : c,
                ),
            }));
        };

        const finalizeMessage = async (finalContent: string) => {
            const finalConv: ChatConversation = {
                ...convWithAssistant,
                updatedAt: Date.now(),
                messages: convWithAssistant.messages.map((m) =>
                    m.id === assistantId
                        ? {
                            ...m,
                            isStreaming: false,
                            content: finalContent,
                            toolCalls:
                                allExecutedTools.length > 0 ? allExecutedTools : undefined,
                        }
                        : m,
                ),
            };
            set((s) => ({
                isStreaming: false,
                conversations: s.conversations.map((c) => (c.id === convId ? finalConv : c)),
            }));
            await DocumentDatabase.saveConversation(finalConv);
        };

        try {
            const aiConfig = useAiConfigStore.getState();
            const llmOpts = aiConfig.getActiveLlmConfig();
            let conversationMessages = messagesWithUser;
            const maxToolRounds = 3;

            for (let round = 0; round < maxToolRounds; round++) {
                let pendingToolCalls: LlmToolCall[] = [];
                const isLastRound = round + 1 >= maxToolRounds;

                await LlmService.streamChat({
                    messages: conversationMessages,
                    systemPrompt: systemPrompt || undefined,
                    ...llmOpts,
                    webSearchEnabled: aiConfig.webSearchEnabled,
                    tools: isLastRound ? undefined : FOLIET_TOOL_DEFINITIONS,
                    signal: abortController.signal,
                    onToolCalls: (calls) => {
                        pendingToolCalls = calls;
                    },
                    onChunk: (chunk) => {
                        accumulatedText += chunk;
                        patchAssistant({ content: accumulatedText });
                    },
                });

                if (pendingToolCalls.length === 0 || abortController.signal.aborted) break;

                const roundExecuted: ExecutedToolCall[] = [];
                for (const tc of pendingToolCalls) {
                    const execRes = await executeCopilotToolCall(tc, {
                        docId: activeDocId,
                        docTitle: activeDocTitle,
                        jumpToPage,
                    });
                    roundExecuted.push(execRes);
                    allExecutedTools.push(execRes);
                }

                patchAssistant({ toolCalls: [...allExecutedTools] });

                const needsFollowUp =
                    accumulatedText.trim().length === 0 ||
                    roundExecuted.some(
                        (t) => t.name === "navigate_to" || t.name === "explain_figure",
                    );
                if (!needsFollowUp || isLastRound) break;

                conversationMessages = [
                    ...messagesWithUser,
                    ...(accumulatedText.trim()
                        ? [
                            {
                                id: assistantId,
                                role: "assistant" as const,
                                content: accumulatedText,
                                timestamp: Date.now(),
                            },
                        ]
                        : []),
                    {
                        id: crypto.randomUUID(),
                        role: "user",
                        content: [
                            "<tool_execution_results>",
                            ...roundExecuted.map((t) => `Tool: ${t.name}\nOutcome: ${t.result}`),
                            "</tool_execution_results>",
                            "Now answer the user's question directly in clear scholarly prose using the retrieved page content above. Do NOT print `[Executed Tools]` or raw JSON tool calls.",
                        ].join("\n\n"),
                        timestamp: Date.now(),
                    },
                ];
            }

            await finalizeMessage(accumulatedText);
        } catch (err: any) {
            const finalContent = isAbortError(err, abortController.signal)
                ? accumulatedText
                : accumulatedText.length > 0
                    ? `${accumulatedText}\n\n[Generation stopped: ${err?.message || "Unknown error"}]`
                    : `[Error: ${err?.message || "Generation failed"}]`;
            await finalizeMessage(finalContent);
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