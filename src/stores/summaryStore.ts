/**
 * Foliet - Document Summarization Store
 */

import { create } from "zustand";
import {
    FOLIET_TOOL_DEFINITIONS,
    LlmService,
    type LlmToolCall,
    type StructuredSummaryInput,
    type SummaryFocusMode,
    type VisionImageInput,
} from "@/services/llm";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import type { PdfAnnotation } from "@/types/annotations";
import type { ChatConversation } from "@/types/chat";
import type { PdfChapter } from "@/types/document";
import { isAbortError } from "@/utils/error";
import {
    type AiSummaryState,
    collectRangeContext,
    executeSummaryToolCalls,
    fetchRangeText,
    readPreviousSummaryBackup,
    resolveCropsForVision,
    resolvePreviousSnapshot,
    upsertChapterSection,
    writePreviousSummaryBackup,
} from "@/utils/summaryUtils";

export type { AiSummaryState };

export interface SummaryGenerationProgress {
    current: number;
    total: number;
    chapterTitle: string;
}

interface ContextFlags {
    includeNotes?: boolean;
    includeChats?: boolean;
    webSearchEnabled?: boolean;
}

export interface ChapterGenerationParams extends ContextFlags {
    docTitle: string;
    chapter: PdfChapter;
    annotations: PdfAnnotation[];
    conversations: ChatConversation[];
}

export interface FullBookGenerationParams extends ContextFlags {
    docTitle: string;
    chapters: PdfChapter[];
    annotations: PdfAnnotation[];
    conversations: ChatConversation[];
}

export interface ModifySummaryParams extends ContextFlags {
    docTitle: string;
    instruction: string;
    existingMarkdown: string;
    activeChapter?: PdfChapter;
    annotations: PdfAnnotation[];
    conversations: ChatConversation[];
    jumpToPage?: (page: number) => void;
}

export interface SummaryStore {
    activeSummary: AiSummaryState | null;
    previousSummary: AiSummaryState | null;
    isLoadingSummary: boolean;
    isSummarizing: boolean;
    isSummaryWorkspaceOpen: boolean;
    summaryFocusMode: SummaryFocusMode;
    chapters: PdfChapter[];
    selectedChapterId: string;
    generationProgress: SummaryGenerationProgress | null;

    setSummaryWorkspaceOpen: (open: boolean) => void;
    setSummaryFocusMode: (mode: SummaryFocusMode) => void;
    setChapters: (chapters: PdfChapter[]) => void;
    setSelectedChapterId: (id: string) => void;
    setPdfProxy: (proxy: any | null) => void;
    updateActiveSummaryLocal: (content: string) => void;

    loadSummary: (docId: string) => Promise<void>;
    restorePreviousSummary: (docId: string) => Promise<void>;
    generateStructuredSummary: (
        docId: string,
        input: StructuredSummaryInput,
    ) => Promise<void>;
    generateChapterSummary: (
        docId: string,
        params: ChapterGenerationParams,
    ) => Promise<void>;
    generateFullBookSummary: (
        docId: string,
        params: FullBookGenerationParams,
    ) => Promise<void>;
    modifySummaryWithInstruction: (
        docId: string,
        params: ModifySummaryParams,
    ) => Promise<void>;
    cancelSummaryStreaming: () => void;
    deleteSummary: (docId: string) => Promise<void>;
}

let activeSummaryAbortController: AbortController | null = null;
let activePdfProxy: any | null = null;
let latestLoadToken = 0;

function beginAbortController(): AbortController {
    activeSummaryAbortController?.abort();
    const controller = new AbortController();
    activeSummaryAbortController = controller;
    return controller;
}

function clearAbortController(controller: AbortController): void {
    if (activeSummaryAbortController === controller) {
        activeSummaryAbortController = null;
    }
}

export const useSummaryStore = create<SummaryStore>((set, get) => {
    const captureBackup = async (docId: string) => {
        const snapshot = await resolvePreviousSnapshot(docId, get().activeSummary);
        if (snapshot) set({ previousSummary: snapshot });
    };

    const streamPrompt = async (params: {
        prompt: string;
        systemPrompt?: string;
        webSearchEnabled?: boolean;
        visionImages?: VisionImageInput[];
        tools?: typeof FOLIET_TOOL_DEFINITIONS;
        signal: AbortSignal;
        onChunk: (chunk: string) => void;
        onToolCalls?: (calls: LlmToolCall[]) => void;
    }) => {
        const llm = useAiConfigStore.getState().getActiveLlmConfig();
        await LlmService.streamChat({
            messages: [
                {
                    id: crypto.randomUUID(),
                    role: "user",
                    content: params.prompt,
                    timestamp: Date.now(),
                },
            ],
            systemPrompt: params.systemPrompt,
            webSearchEnabled:
                llm.provider === "openrouter" && Boolean(params.webSearchEnabled),
            visionImages: params.visionImages?.length ? params.visionImages : undefined,
            tools: params.tools,
            ...llm,
            signal: params.signal,
            onChunk: params.onChunk,
            onToolCalls: params.onToolCalls,
        });
    };

    return {
        activeSummary: null,
        previousSummary: null,
        isLoadingSummary: false,
        isSummarizing: false,
        isSummaryWorkspaceOpen: false,
        summaryFocusMode: "study",
        chapters: [],
        selectedChapterId: "all",
        generationProgress: null,

        setSummaryWorkspaceOpen: (isSummaryWorkspaceOpen) =>
            set({ isSummaryWorkspaceOpen }),
        setSummaryFocusMode: (summaryFocusMode) => set({ summaryFocusMode }),
        setSelectedChapterId: (selectedChapterId) => set({ selectedChapterId }),
        setPdfProxy: (proxy) => {
            activePdfProxy = proxy;
        },

        setChapters: (chapters) =>
            set((s) => ({
                chapters,
                selectedChapterId:
                    s.selectedChapterId === "all" ||
                        chapters.some((c) => c.id === s.selectedChapterId)
                        ? s.selectedChapterId
                        : "all",
            })),

        updateActiveSummaryLocal: (content) =>
            set((s) => ({
                activeSummary: {
                    content,
                    sourceSnapshot: s.activeSummary?.sourceSnapshot,
                    updatedAt: Date.now(),
                },
            })),

        loadSummary: async (docId) => {
            if (get().isSummarizing) return;
            const token = ++latestLoadToken;
            set({
                isLoadingSummary: true,
                previousSummary: readPreviousSummaryBackup(docId),
            });
            try {
                const summary = await DocumentDatabase.getSummary(docId);
                if (token !== latestLoadToken) return;
                set({
                    activeSummary: summary,
                    previousSummary: readPreviousSummaryBackup(docId),
                    isLoadingSummary: false,
                });
            } catch (err) {
                if (token !== latestLoadToken) return;
                console.warn("SummaryStore: Failed to load summary:", err);
                set({ activeSummary: null, isLoadingSummary: false });
            }
        },

        restorePreviousSummary: async (docId) => {
            const backup = get().previousSummary ?? readPreviousSummaryBackup(docId);
            if (!backup?.content?.trim()) return;

            const current = get().activeSummary;
            await DocumentDatabase.saveSummary(
                docId,
                backup.content,
                backup.sourceSnapshot,
            );
            const nextBackup = current?.content?.trim()
                ? {
                    content: current.content,
                    sourceSnapshot: current.sourceSnapshot,
                    updatedAt: current.updatedAt || Date.now(),
                }
                : null;

            writePreviousSummaryBackup(docId, nextBackup);
            set({
                activeSummary: { ...backup, updatedAt: Date.now() },
                previousSummary: nextBackup,
            });
        },

        generateStructuredSummary: async (docId, input) => {
            await captureBackup(docId);
            const { enrichedCrops, visionImages } = await resolveCropsForVision(input.crops);
            const enrichedInput: StructuredSummaryInput = {
                ...input,
                crops: enrichedCrops,
            };
            const sourceSnapshot = JSON.stringify({
                focusMode: enrichedInput.focusMode,
                highlights: enrichedInput.highlights.length,
                notes: enrichedInput.notes.length,
                crops: enrichedInput.crops.length,
                chats: enrichedInput.chatTakeaways.length,
            });

            const controller = beginAbortController();
            set({ isSummarizing: true });
            let accumulated = "";

            try {
                await streamPrompt({
                    prompt: LlmService.buildStructuredSummarizationPrompt(enrichedInput),
                    visionImages,
                    signal: controller.signal,
                    onChunk: (chunk) => {
                        accumulated += chunk;
                        set({
                            activeSummary: {
                                content: accumulated,
                                sourceSnapshot,
                                updatedAt: Date.now(),
                            },
                        });
                    },
                });
                await DocumentDatabase.saveSummary(docId, accumulated, sourceSnapshot);
                set({
                    isSummarizing: false,
                    activeSummary: {
                        content: accumulated,
                        sourceSnapshot,
                        updatedAt: Date.now(),
                    },
                });
            } catch (err) {
                if (isAbortError(err, controller.signal)) {
                    if (accumulated.trim()) {
                        await DocumentDatabase.saveSummary(
                            docId,
                            accumulated,
                            sourceSnapshot,
                        ).catch(() => { });
                        set({
                            isSummarizing: false,
                            activeSummary: {
                                content: accumulated,
                                sourceSnapshot,
                                updatedAt: Date.now(),
                            },
                        });
                    } else {
                        set({ isSummarizing: false });
                    }
                    return;
                }
                set({ isSummarizing: false });
                throw err;
            } finally {
                clearAbortController(controller);
            }
        },

        generateChapterSummary: async (
            docId,
            {
                docTitle,
                chapter,
                annotations,
                conversations,
                includeNotes = true,
                includeChats = false,
                webSearchEnabled = false,
            },
        ) => {
            const controller = beginAbortController();
            await captureBackup(docId);

            const { summaryFocusMode, activeSummary } = get();
            const baseMarkdown = activeSummary?.content ?? "";
            set({
                isSummarizing: true,
                generationProgress: { current: 1, total: 1, chapterTitle: chapter.title },
            });

            let streamedChapter = "";
            try {
                const chapterText = await fetchRangeText(
                    docId,
                    activePdfProxy,
                    chapter.startPage,
                    chapter.endPage,
                );
                const ctx = collectRangeContext(annotations, conversations, {
                    startPage: chapter.startPage,
                    endPage: chapter.endPage,
                    includeNotes,
                    includeChats,
                });
                const { enrichedCrops, visionImages } = await resolveCropsForVision(ctx.crops);

                await streamPrompt({
                    prompt: LlmService.buildChapterSummaryPrompt({
                        docTitle,
                        chapterTitle: chapter.title,
                        startPage: chapter.startPage,
                        endPage: chapter.endPage,
                        focusMode: summaryFocusMode,
                        chapterText,
                        highlights: ctx.highlights,
                        notes: ctx.notes,
                        crops: enrichedCrops,
                        chatTakeaways: ctx.chatTakeaways,
                    }),
                    systemPrompt: LlmService.buildSummarySystemPrompt(
                        summaryFocusMode,
                        docTitle,
                    ),
                    webSearchEnabled,
                    visionImages,
                    signal: controller.signal,
                    onChunk: (chunk) => {
                        streamedChapter += chunk;
                        set({
                            activeSummary: {
                                content: upsertChapterSection(
                                    baseMarkdown,
                                    docTitle,
                                    chapter.title,
                                    streamedChapter,
                                ),
                                updatedAt: Date.now(),
                            },
                        });
                    },
                });

                const finalContent = upsertChapterSection(
                    baseMarkdown,
                    docTitle,
                    chapter.title,
                    streamedChapter,
                );
                await DocumentDatabase.saveSummary(docId, finalContent);
                set({
                    isSummarizing: false,
                    generationProgress: null,
                    activeSummary: { content: finalContent, updatedAt: Date.now() },
                });
            } catch (err) {
                if (isAbortError(err, controller.signal)) {
                    if (streamedChapter.trim()) {
                        const partial = upsertChapterSection(
                            baseMarkdown,
                            docTitle,
                            chapter.title,
                            streamedChapter,
                        );
                        await DocumentDatabase.saveSummary(docId, partial).catch(() => { });
                        set({
                            activeSummary: { content: partial, updatedAt: Date.now() },
                        });
                    }
                    set({ isSummarizing: false, generationProgress: null });
                    return;
                }
                set({ isSummarizing: false, generationProgress: null });
                throw err;
            } finally {
                clearAbortController(controller);
            }
        },

        generateFullBookSummary: async (
            docId,
            {
                docTitle,
                chapters,
                annotations,
                conversations,
                includeNotes = true,
                includeChats = false,
                webSearchEnabled = false,
            },
        ) => {
            if (chapters.length === 0) return;

            const controller = beginAbortController();
            await captureBackup(docId);

            const { summaryFocusMode } = get();
            const systemPrompt = LlmService.buildSummarySystemPrompt(
                summaryFocusMode,
                docTitle,
            );
            let runningMarkdown = `# ${docTitle}\n`;

            set({
                isSummarizing: true,
                activeSummary: { content: runningMarkdown, updatedAt: Date.now() },
                generationProgress: {
                    current: 1,
                    total: chapters.length,
                    chapterTitle: chapters[0].title,
                },
            });

            try {
                for (let i = 0; i < chapters.length; i++) {
                    if (controller.signal.aborted) break;
                    const chapter = chapters[i];
                    set({
                        generationProgress: {
                            current: i + 1,
                            total: chapters.length,
                            chapterTitle: chapter.title,
                        },
                    });

                    const chapterText = await fetchRangeText(
                        docId,
                        activePdfProxy,
                        chapter.startPage,
                        chapter.endPage,
                    );
                    const ctx = collectRangeContext(annotations, conversations, {
                        startPage: chapter.startPage,
                        endPage: chapter.endPage,
                        includeNotes,
                        includeChats,
                    });
                    const { enrichedCrops, visionImages } = await resolveCropsForVision(
                        ctx.crops,
                    );

                    let chapterOutput = "";
                    await streamPrompt({
                        prompt: LlmService.buildChapterSummaryPrompt({
                            docTitle,
                            chapterTitle: chapter.title,
                            startPage: chapter.startPage,
                            endPage: chapter.endPage,
                            focusMode: summaryFocusMode,
                            chapterText,
                            highlights: ctx.highlights,
                            notes: ctx.notes,
                            crops: enrichedCrops,
                            chatTakeaways: ctx.chatTakeaways,
                        }),
                        systemPrompt,
                        webSearchEnabled,
                        visionImages,
                        signal: controller.signal,
                        onChunk: (chunk) => {
                            chapterOutput += chunk;
                            set({
                                activeSummary: {
                                    content: upsertChapterSection(
                                        runningMarkdown,
                                        docTitle,
                                        chapter.title,
                                        chapterOutput,
                                    ),
                                    updatedAt: Date.now(),
                                },
                            });
                        },
                    });

                    runningMarkdown = upsertChapterSection(
                        runningMarkdown,
                        docTitle,
                        chapter.title,
                        chapterOutput,
                    );
                    await DocumentDatabase.saveSummary(docId, runningMarkdown);
                    set({
                        activeSummary: {
                            content: runningMarkdown,
                            updatedAt: Date.now(),
                        },
                    });
                }
                set({ isSummarizing: false, generationProgress: null });
            } catch (err) {
                if (isAbortError(err, controller.signal)) {
                    if (runningMarkdown.trim().length > docTitle.length + 4) {
                        await DocumentDatabase.saveSummary(docId, runningMarkdown).catch(
                            () => { },
                        );
                    }
                    set({ isSummarizing: false, generationProgress: null });
                    return;
                }
                set({ isSummarizing: false, generationProgress: null });
                throw err;
            } finally {
                clearAbortController(controller);
            }
        },

        modifySummaryWithInstruction: async (
            docId,
            {
                docTitle,
                instruction,
                existingMarkdown,
                activeChapter,
                annotations,
                conversations,
                jumpToPage,
                includeNotes = true,
                includeChats = false,
                webSearchEnabled = false,
            },
        ) => {
            const controller = beginAbortController();

            if (existingMarkdown.trim()) {
                const snapshot: AiSummaryState = {
                    content: existingMarkdown,
                    sourceSnapshot: get().activeSummary?.sourceSnapshot,
                    updatedAt: get().activeSummary?.updatedAt || Date.now(),
                };
                writePreviousSummaryBackup(docId, snapshot);
                set({ previousSummary: snapshot });
            } else {
                await captureBackup(docId);
            }

            const { summaryFocusMode } = get();
            set({ isSummarizing: true, generationProgress: null });
            let accumulated = "";

            try {
                const ctx = collectRangeContext(annotations, conversations, {
                    startPage: activeChapter?.startPage,
                    endPage: activeChapter?.endPage,
                    includeNotes,
                    includeChats,
                });
                const { enrichedCrops, visionImages } = await resolveCropsForVision(ctx.crops);
                const chapterContext = activeChapter
                    ? {
                        title: activeChapter.title,
                        startPage: activeChapter.startPage,
                        endPage: activeChapter.endPage,
                        text: await fetchRangeText(
                            docId,
                            activePdfProxy,
                            activeChapter.startPage,
                            activeChapter.endPage,
                        ),
                    }
                    : undefined;

                const systemPrompt = LlmService.buildSummarySystemPrompt(
                    summaryFocusMode,
                    docTitle,
                );
                const basePrompt = LlmService.buildModifySummaryPrompt({
                    docTitle,
                    focusMode: summaryFocusMode,
                    existingMarkdown,
                    instruction,
                    chapterContext,
                    highlights: ctx.highlights,
                    notes: ctx.notes,
                    crops: enrichedCrops,
                    chatTakeaways: ctx.chatTakeaways,
                });

                const summaryTools = FOLIET_TOOL_DEFINITIONS.filter(
                    (t) => t.name === "add_figure_to_summary" || t.name === "navigate_to",
                );

                let pendingToolCalls: LlmToolCall[] = [];
                await streamPrompt({
                    prompt: basePrompt,
                    systemPrompt,
                    webSearchEnabled,
                    visionImages,
                    tools: summaryTools,
                    signal: controller.signal,
                    onToolCalls: (calls) => {
                        pendingToolCalls = calls;
                    },
                    onChunk: (chunk) => {
                        accumulated += chunk;
                        set({
                            activeSummary: { content: accumulated, updatedAt: Date.now() },
                        });
                    },
                });

                if (pendingToolCalls.length > 0 && !controller.signal.aborted) {
                    const { toolResults, extraVision } = await executeSummaryToolCalls(
                        pendingToolCalls,
                        {
                            docId,
                            pdfProxy: activePdfProxy,
                            initialVision: visionImages,
                            jumpToPage,
                        },
                    );
                    if (toolResults.length > 0) {
                        accumulated = "";
                        const llm = useAiConfigStore.getState().getActiveLlmConfig();
                        await LlmService.streamChat({
                            messages: [
                                {
                                    id: crypto.randomUUID(),
                                    role: "user",
                                    content: basePrompt,
                                    timestamp: Date.now(),
                                },
                                {
                                    id: crypto.randomUUID(),
                                    role: "user",
                                    content: [
                                        "<tool_execution_results>",
                                        ...toolResults,
                                        "</tool_execution_results>",
                                        "Now output the complete updated summary Markdown incorporating the tool results above.",
                                    ].join("\n\n"),
                                    timestamp: Date.now(),
                                },
                            ],
                            systemPrompt,
                            webSearchEnabled: llm.provider === "openrouter" && webSearchEnabled,
                            visionImages: extraVision.length ? extraVision : undefined,
                            ...llm,
                            signal: controller.signal,
                            onChunk: (chunk) => {
                                accumulated += chunk;
                                set({
                                    activeSummary: {
                                        content: accumulated,
                                        updatedAt: Date.now(),
                                    },
                                });
                            },
                        });
                    }
                }

                if (accumulated.trim()) {
                    await DocumentDatabase.saveSummary(docId, accumulated);
                    set({
                        isSummarizing: false,
                        activeSummary: { content: accumulated, updatedAt: Date.now() },
                    });
                } else {
                    set({ isSummarizing: false });
                }
            } catch (err) {
                if (isAbortError(err, controller.signal)) {
                    if (accumulated.trim()) {
                        await DocumentDatabase.saveSummary(docId, accumulated).catch(
                            () => { },
                        );
                        set({
                            isSummarizing: false,
                            activeSummary: { content: accumulated, updatedAt: Date.now() },
                        });
                    } else {
                        set({ isSummarizing: false });
                    }
                    return;
                }
                set({ isSummarizing: false });
                throw err;
            } finally {
                clearAbortController(controller);
            }
        },

        cancelSummaryStreaming: () => {
            activeSummaryAbortController?.abort();
            activeSummaryAbortController = null;
            set({ isSummarizing: false, generationProgress: null });
        },

        deleteSummary: async (docId) => {
            await captureBackup(docId);
            await DocumentDatabase.deleteSummary(docId);
            set({ activeSummary: null });
        },
    };
});