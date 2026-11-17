/**
 * Foliet - Persistent Chat & Streaming Store
 *
 * Manages SQLite-backed conversations, selection context handoff,
 * RAG-grounded prompt injection, LLM tool execution (`navigate_to`,
 * `highlight_passage`, `explain_figure`, `add_figure_to_summary`), and abortable LLM streaming.
 */

import { create } from "zustand";
import {
    captureFigureCropFromPage,
    insertFigureIntoSummary,
} from "@/services/figureCropper";
import {
    FOLIET_TOOL_DEFINITIONS,
    LlmService,
    type LlmToolCall,
    type RagPromptContextItem,
} from "@/services/llm";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import type { TextMarkupAnnotation } from "@/types/annotations";
import type {
    ChatConversation,
    ChatMessage,
    CitationReference,
    ExecutedToolCall,
} from "@/types/chat";
import type { RectSegment } from "@/types/embedding";

export interface ChatStore {
    conversations: ChatConversation[];
    activeConversationId: string | null;
    isStreaming: boolean;
    pendingContextSnippet: CitationReference | null;

    loadConversations: (docId?: string) => Promise<void>;
    setActiveConversationId: (id: string | null) => void;
    createConversation: (
        title?: string,
        docId?: string,
    ) => Promise<ChatConversation>;
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

function mergeLineRects(rects: RectSegment[]): RectSegment[] {
    if (rects.length <= 1) return rects;
    const sorted = [...rects].sort((a, b) =>
        Math.abs(a.y - b.y) > 0.004 ? a.y - b.y : a.x - b.x,
    );
    const merged: RectSegment[] = [];
    for (const r of sorted) {
        const target = merged.find((m) => {
            const overlapY =
                Math.min(m.y + m.height, r.y + r.height) - Math.max(m.y, r.y);
            const minH = Math.min(m.height, r.height);
            const sameLine = minH > 0 && overlapY / minH > 0.5;
            const horizontalTouch =
                r.x <= m.x + m.width + 0.008 && m.x <= r.x + r.width + 0.008;
            return sameLine && horizontalTouch;
        });
        if (target) {
            const minX = Math.min(target.x, r.x);
            const minY = Math.min(target.y, r.y);
            const maxX = Math.max(target.x + target.width, r.x + r.width);
            const maxY = Math.max(target.y + target.height, r.y + r.height);
            target.x = minX;
            target.y = minY;
            target.width = maxX - minX;
            target.height = maxY - minY;
        } else {
            merged.push({ ...r });
        }
    }
    return merged;
}

function readDomPageText(pageNumber: number): string {
    if (typeof document === "undefined") return "";
    const pageWrapper = document.querySelector(
        `[data-page-number="${pageNumber}"]`,
    ) as HTMLElement | null;
    const textLayer = pageWrapper?.querySelector(
        ".react-pdf__Page__textContent, .textLayer",
    ) as HTMLElement | null;
    if (!textLayer) return "";
    return (textLayer.innerText || textLayer.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
}

function readAnyRenderedPagesContext(): RagPromptContextItem[] {
    if (typeof document === "undefined") return [];
    const pages = Array.from(
        document.querySelectorAll("[data-page-number]"),
    ) as HTMLElement[];
    const items: RagPromptContextItem[] = [];
    for (const el of pages) {
        const pageNumber = Number(el.getAttribute("data-page-number"));
        if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;
        const text = readDomPageText(pageNumber);
        if (text.length >= 20) {
            items.push({ pageNumber, text: text.slice(0, 1800) });
        }
        if (items.length >= 4) break;
    }
    return items;
}

async function readPageContextText(
    docId: string | undefined,
    pageNumber: number,
    jumpToPage?: (page: number) => void,
): Promise<string> {
    if (docId) {
        try {
            const chunks = await RagService.getDocumentChunks(docId);
            const pageChunks = chunks.filter((c) => c.pageNumber === pageNumber);
            if (pageChunks.length > 0) {
                return pageChunks
                    .slice(0, 3)
                    .map((c) => c.text)
                    .join("\n\n")
                    .slice(0, 2200);
            }
        } catch {
            // Fall through to DOM textLayer
        }
    }

    const immediateDom = readDomPageText(pageNumber);
    if (immediateDom) return immediateDom.slice(0, 2200);

    if (jumpToPage) {
        jumpToPage(pageNumber);
        await new Promise((r) => setTimeout(r, 260));
        const afterJumpDom = readDomPageText(pageNumber);
        if (afterJumpDom) return afterJumpDom.slice(0, 2200);
    }

    return "";
}

/**
 * Resolves exact line bounding rectangles from a rendered PDF page's DOM textLayer.
 */
function resolveDomTextRects(
    pageNumber: number,
    targetText: string,
): RectSegment[] {
    if (typeof document === "undefined") return [];
    const pageWrapper = document.querySelector(
        `[data-page-number="${pageNumber}"]`,
    ) as HTMLElement | null;
    if (!pageWrapper) return [];

    const textLayer = pageWrapper.querySelector(
        ".react-pdf__Page__textContent, .textLayer",
    ) as HTMLElement | null;
    if (!textLayer) return [];

    const pageRect = pageWrapper.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return [];

    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    const textNodes: Array<{ node: Text; start: number; end: number }> = [];
    let normalizedFull = "";

    let current: Node | null;
    while ((current = walker.nextNode())) {
        const txt = current as Text;
        const val = txt.nodeValue ?? "";
        if (!val) continue;
        const start = normalizedFull.length;
        normalizedFull += val;
        textNodes.push({ node: txt, start, end: normalizedFull.length });
    }

    if (!normalizedFull.trim()) return [];

    const rawLower = normalizedFull.toLowerCase();
    const compactChars: string[] = [];
    const compactToRaw: number[] = [];
    let prevWasSpace = true;

    for (let i = 0; i < rawLower.length; i++) {
        const ch = rawLower[i];
        const isSpace = /\s/.test(ch);
        if (isSpace) {
            if (!prevWasSpace) {
                compactChars.push(" ");
                compactToRaw.push(i);
                prevWasSpace = true;
            }
        } else {
            compactChars.push(ch);
            compactToRaw.push(i);
            prevWasSpace = false;
        }
    }

    const compactHaystack = compactChars.join("");
    const compactNeedle = targetText.toLowerCase().replace(/\s+/g, " ").trim();
    if (!compactNeedle) return [];

    let matchStartCompact = compactHaystack.indexOf(compactNeedle);
    let matchLenCompact = compactNeedle.length;

    if (matchStartCompact === -1) {
        const words = compactNeedle.split(" ").filter(Boolean);
        if (words.length >= 4) {
            const head = words.slice(0, Math.min(6, words.length)).join(" ");
            matchStartCompact = compactHaystack.indexOf(head);
            matchLenCompact = head.length;
        }
    }

    if (matchStartCompact === -1) return [];

    const rawStart = compactToRaw[matchStartCompact] ?? 0;
    const rawEndCompactIdx = Math.min(
        compactToRaw.length - 1,
        matchStartCompact + matchLenCompact - 1,
    );
    const rawEnd = (compactToRaw[rawEndCompactIdx] ?? rawStart) + 1;

    const startEntry = textNodes.find(
        (n) => rawStart >= n.start && rawStart < n.end,
    );
    const endEntry = textNodes.find((n) => rawEnd > n.start && rawEnd <= n.end);
    if (!startEntry || !endEntry) return [];

    try {
        const range = document.createRange();
        range.setStart(startEntry.node, Math.max(0, rawStart - startEntry.start));
        range.setEnd(
            endEntry.node,
            Math.min(endEntry.node.length, rawEnd - endEntry.start),
        );
        const rects = Array.from(range.getClientRects())
            .map((r) => ({
                x: Math.max(0, (r.left - pageRect.left) / pageRect.width),
                y: Math.max(0, (r.top - pageRect.top) / pageRect.height),
                width: Math.min(1, r.width / pageRect.width),
                height: Math.min(1, r.height / pageRect.height),
            }))
            .filter((r) => r.width > 0.002 && r.height > 0.002);

        return mergeLineRects(rects);
    } catch {
        return [];
    }
}

async function resolvePassageRects(
    docId: string | undefined,
    pageNumber: number,
    passageText: string,
    jumpToPage?: (page: number) => void,
): Promise<RectSegment[]> {
    const domRects = resolveDomTextRects(pageNumber, passageText);
    if (domRects.length > 0) return domRects;

    if (docId) {
        try {
            const chunks = await RagService.getDocumentChunks(docId);
            const pageChunks = chunks.filter((c) => c.pageNumber === pageNumber);
            const needle = passageText.toLowerCase().replace(/\s+/g, " ").trim();
            const matched =
                pageChunks.find((c) =>
                    c.text
                        .toLowerCase()
                        .replace(/\s+/g, " ")
                        .includes(needle.slice(0, 60)),
                ) ?? pageChunks[0];
            if (matched?.rectSegments?.length) {
                return matched.rectSegments;
            }
        } catch {
            // Fall through to jump + DOM retry
        }
    }

    if (jumpToPage) {
        jumpToPage(pageNumber);
        await new Promise((r) => setTimeout(r, 260));
        const retried = resolveDomTextRects(pageNumber, passageText);
        if (retried.length > 0) return retried;
    }

    return [];
}

async function executeToolCall(
    call: LlmToolCall,
    context: {
        docId?: string;
        docTitle?: string;
        jumpToPage?: (page: number) => void;
    },
): Promise<ExecutedToolCall> {
    const args = call.arguments || {};
    const pageNumber = Math.max(1, Math.round(Number(args.pageNumber) || 1));

    if (call.name === "navigate_to") {
        if (context.jumpToPage) {
            context.jumpToPage(pageNumber);
        }
        const reason =
            typeof args.reason === "string" && args.reason.trim()
                ? ` (${args.reason.trim()})`
                : "";
        const pageText = await readPageContextText(
            context.docId,
            pageNumber,
            context.jumpToPage,
        );
        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, reason: args.reason },
            status: "success",
            badgeLabel: `⚡ Navigated to Page ${pageNumber}`,
            result: pageText
                ? `Viewer navigated to Page ${pageNumber}${reason}. Page ${pageNumber} text:\n${pageText}`
                : `Viewer navigated to Page ${pageNumber}${reason}. (No extractable text found on this page yet.)`,
        };
    }

    if (call.name === "highlight_passage") {
        const passageText = String(args.text ?? "").trim();
        const color =
            typeof args.color === "string" && args.color.trim()
                ? args.color.trim()
                : "#FDE047";
        const label =
            typeof args.label === "string" && args.label.trim()
                ? args.label.trim()
                : "key finding";

        if (!context.docId || !passageText) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, text: passageText, color, label },
                status: "error",
                badgeLabel: `⚠️ Could not highlight Page ${pageNumber}`,
                result: "Missing active document ID or passage text.",
            };
        }

        const rectSegments = await resolvePassageRects(
            context.docId,
            pageNumber,
            passageText,
            context.jumpToPage,
        );

        if (rectSegments.length === 0) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, text: passageText, color, label },
                status: "error",
                badgeLabel: `⚡ Navigated to Page ${pageNumber}`,
                result: `Navigated to Page ${pageNumber}, but exact line coordinates for "${passageText.slice(0, 60)}" could not be resolved.`,
            };
        }

        const annotation: TextMarkupAnnotation = {
            id: `markup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            pageNumber,
            toolType: "highlight",
            color,
            text: passageText,
            rectSegments,
            x: rectSegments[0].x,
            y: rectSegments[0].y,
            createdAt: new Date().toISOString(),
        };

        await DocumentDatabase.saveAnnotations(context.docId, [annotation]);

        const docStoreAny = useDocumentStore.getState() as unknown as {
            addAnnotation?: (a: TextMarkupAnnotation) => void;
            loadAnnotations?: (docId: string) => Promise<void>;
        };
        if (typeof docStoreAny.addAnnotation === "function") {
            docStoreAny.addAnnotation(annotation);
        } else if (typeof docStoreAny.loadAnnotations === "function") {
            void docStoreAny.loadAnnotations(context.docId);
        }
        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent("foliet:annotation-saved", {
                    detail: { docId: context.docId, annotation },
                }),
            );
        }

        if (context.jumpToPage) {
            context.jumpToPage(pageNumber);
        }
        useRagStore.getState().setActiveRagHighlight({
            chunkId: annotation.id,
            docId: context.docId,
            docTitle: context.docTitle || "Document",
            pageNumber,
            text: passageText,
            similarityScore: 1.0,
            rectSegments,
        });

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, text: passageText, color, label },
            status: "success",
            badgeLabel: `✏️ Highlighted ${label}`,
            result: `Persisted highlight annotation on Page ${pageNumber} for "${passageText.slice(0, 120)}".`,
        };
    }

    if (call.name === "explain_figure") {
        if (context.jumpToPage) {
            context.jumpToPage(pageNumber);
        }
        const caption = typeof args.caption === "string" ? args.caption.trim() : "";

        let pageContext = "";
        if (context.docId) {
            try {
                const chunks = await RagService.getDocumentChunks(context.docId);
                const pageChunks = chunks.filter((c) => c.pageNumber === pageNumber);
                if (pageChunks.length > 0) {
                    const matched =
                        (caption &&
                            pageChunks.find((c) =>
                                c.text.toLowerCase().includes(caption.toLowerCase()),
                            )) ||
                        pageChunks[0];
                    useRagStore.getState().setActiveRagHighlight({
                        chunkId: matched.chunkId,
                        docId: context.docId,
                        docTitle: context.docTitle || "Document",
                        pageNumber,
                        text: matched.text,
                        similarityScore: 1.0,
                        rectSegments: matched.rectSegments,
                    });
                    pageContext = pageChunks
                        .slice(0, 2)
                        .map((c) => c.text)
                        .join("\n\n")
                        .slice(0, 1800);
                }
            } catch {
                // Fall back to DOM textLayer
            }
        }

        if (!pageContext) {
            pageContext = await readPageContextText(
                context.docId,
                pageNumber,
                context.jumpToPage,
            );
        }

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, caption },
            status: "success",
            badgeLabel: `🖼️ Focused Figure on Page ${pageNumber}`,
            result: pageContext
                ? `Navigated to Page ${pageNumber}${caption ? ` (${caption})` : ""}. Page context:\n${pageContext}`
                : `Navigated to Page ${pageNumber}${caption ? ` (${caption})` : ""}.`,
        };
    }

    if (call.name === "add_figure_to_summary") {
        const caption = typeof args.caption === "string" ? args.caption.trim() : undefined;
        const captured = await captureFigureCropFromPage(pageNumber, caption, {
            docId: context.docId,
            jumpToPage: context.jumpToPage,
        });

        if (!captured) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, caption },
                status: "error",
                badgeLabel: `⚠️ Could not capture figure on Page ${pageNumber}`,
                result: `Failed to locate or render canvas for Page ${pageNumber}.`,
            };
        }

        await insertFigureIntoSummary(captured.crop, context.docId);
        const uri = captured.crop.imageUrl.startsWith("idb://")
            ? captured.crop.imageUrl
            : `idb://${captured.crop.id}`;
        const label = captured.crop.caption || `Figure (Page ${pageNumber})`;

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, caption },
            status: "success",
            badgeLabel: `📎 Added figure from Page ${pageNumber} to Summary`,
            result: `Inserted ![${label}](${uri}) into the active summary (${captured.created ? "newly captured from page canvas" : "reused existing crop"}).`,
        };
    }

    return {
        id: call.id,
        name: call.name,
        arguments: args,
        status: "error",
        badgeLabel: `⚠️ Unknown tool: ${call.name}`,
        result: `Unsupported tool "${call.name}".`,
    };
}

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
                    (c) => c.id === state.activeConversationId,
                );
                return {
                    conversations,
                    activeConversationId: currentActiveExists
                        ? state.activeConversationId
                        : (conversations[0]?.id ?? null),
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
            conversations: state.conversations.map((c) =>
                c.id === id ? updated : c,
            ),
        }));
        await DocumentDatabase.saveConversation(updated);
    },

    setPendingContextSnippet: (snippet) => {
        set({ pendingContextSnippet: snippet });
    },

    setViewerJumpHandler: (handler) => {
        registeredJumpHandler = handler;
    },

    sendMessage: async (content, options) => {
        const text = content.trim();
        if (!text) return;

        if (get().isStreaming) {
            get().cancelStreaming();
        }

        const state = get();
        let conv = state.conversations.find(
            (c) => c.id === state.activeConversationId,
        );
        if (!conv) {
            const initialTitle = text.length > 36 ? `${text.slice(0, 36)}...` : text;
            conv = await get().createConversation(initialTitle, options?.docId);
        }

        const convId = conv.id;
        const activeDoc = useDocumentStore.getState().activeDoc;
        const activeDocId = options?.docId ?? conv.docId ?? activeDoc?.id;
        const activeDocTitle =
            options?.docTitle ?? activeDoc?.title ?? "Current Document";
        const jumpToPage =
            options?.onNavigateToPage ?? registeredJumpHandler ?? undefined;

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
            conversations: s.conversations.map((c) =>
                c.id === convId ? convWithUser : c,
            ),
        }));
        await DocumentDatabase.saveConversation(convWithUser);

        const aiConfig = useAiConfigStore.getState();
        const searchScope = useRagStore.getState().searchScope;
        let systemPrompt = "";
        let citations: CitationReference[] = [];
        const shouldSearchRag = options?.useRag ?? true;
        const targetDocId = searchScope === "current" ? activeDocId : undefined;

        if (shouldSearchRag) {
            try {
                const ragResults = await RagService.searchRag(
                    {
                        query: text,
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
                    systemPrompt = LlmService.buildRagSystemPrompt(
                        ragResults,
                        activeDocTitle,
                        true,
                    );
                } else if (activeDocId) {
                    const docChunks = await RagService.getDocumentChunks(
                        activeDocId,
                    ).catch(() => []);
                    if (docChunks.length > 0) {
                        const openingChunks = docChunks.slice(0, 5);
                        citations = openingChunks.map((c) => ({
                            chunkId: c.chunkId,
                            docId: activeDocId,
                            docTitle: activeDocTitle,
                            pageNumber: c.pageNumber,
                            snippet: c.text.slice(0, 200),
                        }));
                        systemPrompt = LlmService.buildRagSystemPrompt(
                            openingChunks.map((c) => ({
                                text: c.text,
                                pageNumber: c.pageNumber,
                                docTitle: activeDocTitle,
                            })),
                            activeDocTitle,
                            true,
                        );
                    }
                }
            } catch (ragErr) {
                console.warn(
                    "ChatStore: RAG retrieval failed, proceeding with fallback context:",
                    ragErr,
                );
            }
        }

        if (!systemPrompt) {
            const renderedPages = readAnyRenderedPagesContext();
            if (renderedPages.length > 0) {
                systemPrompt = LlmService.buildRagSystemPrompt(
                    renderedPages.map((p) => ({
                        text: p.text,
                        pageNumber: p.pageNumber,
                        docTitle: activeDocTitle,
                    })),
                    activeDocTitle,
                    true,
                );
            } else {
                systemPrompt = [
                    `You are Foliet's scholarly research assistant (Lio). The user has "${activeDocTitle}" open in the PDF viewer.`,
                    activeDoc?.isIndexed
                        ? "You can call `navigate_to`, `highlight_passage`, `explain_figure`, or `add_figure_to_summary` to inspect, cite, and capture pages."
                        : "Note: This PDF has not been indexed in RAG Search yet, and no page text is currently loaded. You may call `navigate_to(pageNumber: 1)` to jump to and read a page, or remind the user to click 'Index Document' in the RAG Search tab for full-book semantic search.",
                ].join(" ");
            }
        }

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
            conversations: s.conversations.map((c) =>
                c.id === convId ? convWithAssistant : c,
            ),
        }));

        let accumulatedText = "";
        const allExecutedTools: ExecutedToolCall[] = [];

        const updateAssistantMessage = (patch: Partial<ChatMessage>) => {
            set((s) => ({
                conversations: s.conversations.map((c) => {
                    if (c.id !== convId) return c;
                    return {
                        ...c,
                        messages: c.messages.map((m) =>
                            m.id === assistantId ? { ...m, ...patch } : m,
                        ),
                    };
                }),
            }));
        };

        try {
            const {
                llmProvider: provider,
                llmModel: model,
                apiKeys,
                ollamaEndpoint,
                webSearchEnabled,
            } = useAiConfigStore.getState();
            const apiKey = apiKeys[provider] ?? "";

            let conversationMessages = messagesWithUser;
            const maxToolRounds = 3;

            for (let round = 0; round < maxToolRounds; round++) {
                let pendingToolCalls: LlmToolCall[] = [];
                const isLastRound = round + 1 >= maxToolRounds;

                await LlmService.streamChat({
                    messages: conversationMessages,
                    systemPrompt: systemPrompt || undefined,
                    provider,
                    model,
                    apiKey,
                    ollamaEndpoint,
                    webSearchEnabled,
                    tools: isLastRound ? undefined : FOLIET_TOOL_DEFINITIONS,
                    signal: abortController.signal,
                    onToolCalls: (calls) => {
                        pendingToolCalls = calls;
                    },
                    onChunk: (chunk) => {
                        accumulatedText += chunk;
                        updateAssistantMessage({ content: accumulatedText });
                    },
                });

                if (pendingToolCalls.length === 0 || abortController.signal.aborted) {
                    break;
                }

                const roundExecuted: ExecutedToolCall[] = [];
                for (const tc of pendingToolCalls) {
                    const execRes = await executeToolCall(tc, {
                        docId: activeDocId,
                        docTitle: activeDocTitle,
                        jumpToPage,
                    });
                    roundExecuted.push(execRes);
                    allExecutedTools.push(execRes);
                }

                updateAssistantMessage({
                    toolCalls: [...allExecutedTools],
                });

                const needsFollowUpReasoning =
                    accumulatedText.trim().length === 0 ||
                    roundExecuted.some(
                        (t) => t.name === "navigate_to" || t.name === "explain_figure",
                    );

                if (!needsFollowUpReasoning || isLastRound) {
                    break;
                }

                const toolContextMessage: ChatMessage = {
                    id: crypto.randomUUID(),
                    role: "user",
                    content: [
                        "<tool_execution_results>",
                        ...roundExecuted.map(
                            (t) => `Tool: ${t.name}\nOutcome: ${t.result}`,
                        ),
                        "</tool_execution_results>",
                        "Now answer the user's question directly in clear scholarly prose using the retrieved page content above. Do NOT print `[Executed Tools]` or raw JSON tool calls.",
                    ].join("\n\n"),
                    timestamp: Date.now(),
                };

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
                    toolContextMessage,
                ];
            }

            const finalConv: ChatConversation = {
                ...convWithAssistant,
                updatedAt: Date.now(),
                messages: convWithAssistant.messages.map((m) =>
                    m.id === assistantId
                        ? {
                            ...m,
                            isStreaming: false,
                            content: accumulatedText,
                            toolCalls:
                                allExecutedTools.length > 0 ? allExecutedTools : undefined,
                        }
                        : m,
                ),
            };

            set((s) => ({
                isStreaming: false,
                conversations: s.conversations.map((c) =>
                    c.id === convId ? finalConv : c,
                ),
            }));
            await DocumentDatabase.saveConversation(finalConv);
        } catch (err: any) {
            const isAborted =
                err?.name === "AbortError" || abortController.signal.aborted;
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
                conversations: s.conversations.map((c) =>
                    c.id === convId ? finalConv : c,
                ),
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
