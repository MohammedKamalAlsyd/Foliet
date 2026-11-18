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
import type { ChatConversation, ChatMessage } from "@/types/chat";
import type { PdfChapter } from "@/types/document";
import { isAbortError } from "@/utils/error";
import { formatToolResultsPrompt } from "@/utils/llmFormatting";
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

async function prepareChapterPromptData(params: {
    docId: string;
    docTitle: string;
    chapter: PdfChapter;
    focusMode: SummaryFocusMode;
    annotations: PdfAnnotation[];
    conversations: ChatConversation[];
    includeNotes: boolean;
    includeChats: boolean;
}) {
    const chapterText = await fetchRangeText(
        params.docId,
        activePdfProxy,
        params.chapter.startPage,
        params.chapter.endPage,
    );
    const ctx = collectRangeContext(params.annotations, params.conversations, {
        startPage: params.chapter.startPage,
        endPage: params.chapter.endPage,
        includeNotes: params.includeNotes,
        includeChats: params.includeChats,
    });
    const { enrichedCrops, visionImages } = await resolveCropsForVision(ctx.crops);
    const prompt = LlmService.buildChapterSummaryPrompt({
        docTitle: params.docTitle,
        chapterTitle: params.chapter.title,
        startPage: params.chapter.startPage,
        endPage: params.chapter.endPage,
        focusMode: params.focusMode,
        chapterText,
        highlights: ctx.highlights,
        notes: ctx.notes,
        crops: enrichedCrops,
        chatTakeaways: ctx.chatTakeaways,
    });
    return { prompt, visionImages };
}

export const useSummaryStore = create<SummaryStore>((set, get) => {
    const captureBackup = async (docId: string) => {
        const snapshot = await resolvePreviousSnapshot(docId, get().activeSummary);
        if (snapshot) set({ previousSummary: snapshot });
    };

    const runSummaryTask = async (
        task: (signal: AbortSignal) => Promise<void>,
        onAbort?: () => Promise<void> | void,
    ) => {
        const controller = beginAbortController();
        set({ isSummarizing: true });
        try {
            await task(controller.signal);
        } catch (err) {
            if (isAbortError(err, controller.signal)) {
                await onAbort?.();
                return;
            }
            throw err;
        } finally {
            set({ isSummarizing: false, generationProgress: null });
            clearAbortController(controller);
        }
    };

    const streamPrompt = async (params: {
        prompt?: string;
        messages?: ChatMessage[];
        systemPrompt?: string;
        webSearchEnabled?: boolean;
        visionImages?: VisionImageInput[];
        tools?: typeof FOLIET_TOOL_DEFINITIONS;
        signal: AbortSignal;
        onChunk: (chunk: string) => void;
        onToolCalls?: (calls: LlmToolCall[]) => void;
    }) => {
        const llm = useAiConfigStore.getState().getActiveLlmConfig();
        const messages: ChatMessage[] = params.messages ?? [
            {
                id: crypto.randomUUID(),
                role: "user",
                content: params.prompt ?? "",
                timestamp: Date.now(),
            },
        ];
        await LlmService.streamChat({
            messages,
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

            let accumulated = "";
            const saveSnapshot = async () => {
                await DocumentDatabase.saveSummary(docId, accumulated, sourceSnapshot);
                set({
                    activeSummary: {
                        content: accumulated,
                        sourceSnapshot,
                        updatedAt: Date.now(),
                    },
                });
            };

            await runSummaryTask(
                async (signal) => {
                    await streamPrompt({
                        prompt: LlmService.buildStructuredSummarizationPrompt(enrichedInput),
                        visionImages,
                        signal,
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
                    await saveSnapshot();
                },
                async () => {
                    if (accumulated.trim()) {
                        await saveSnapshot().catch(() => { });
                    }
                },
            );
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
            await captureBackup(docId);
            const { summaryFocusMode, activeSummary } = get();
            const baseMarkdown = activeSummary?.content ?? "";
            let streamedChapter = "";

            await runSummaryTask(
                async (signal) => {
                    set({
                        generationProgress: { current: 1, total: 1, chapterTitle: chapter.title },
                    });
                    const { prompt, visionImages } = await prepareChapterPromptData({
                        docId,
                        docTitle,
                        chapter,
                        focusMode: summaryFocusMode,
                        annotations,
                        conversations,
                        includeNotes,
                        includeChats,
                    });

                    await streamPrompt({
                        prompt,
                        systemPrompt: LlmService.buildSummarySystemPrompt(
                            summaryFocusMode,
                            docTitle,
                        ),
                        webSearchEnabled,
                        visionImages,
                        signal,
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
                        activeSummary: { content: finalContent, updatedAt: Date.now() },
                    });
                },
                async () => {
                    if (!streamedChapter.trim()) return;
                    const partial = upsertChapterSection(
                        baseMarkdown,
                        docTitle,
                        chapter.title,
                        streamedChapter,
                    );
                    await DocumentDatabase.saveSummary(docId, partial).catch(() => { });
                    set({ activeSummary: { content: partial, updatedAt: Date.now() } });
                },
            );
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

            await captureBackup(docId);
            const { summaryFocusMode } = get();
            const systemPrompt = LlmService.buildSummarySystemPrompt(
                summaryFocusMode,
                docTitle,
            );
            let runningMarkdown = `# ${docTitle}\n`;

            await runSummaryTask(
                async (signal) => {
                    set({
                        activeSummary: { content: runningMarkdown, updatedAt: Date.now() },
                        generationProgress: {
                            current: 1,
                            total: chapters.length,
                            chapterTitle: chapters[0].title,
                        },
                    });

                    for (let i = 0; i < chapters.length; i++) {
                        if (signal.aborted) break;
                        const chapter = chapters[i];
                        set({
                            generationProgress: {
                                current: i + 1,
                                total: chapters.length,
                                chapterTitle: chapter.title,
                            },
                        });

                        const { prompt, visionImages } = await prepareChapterPromptData({
                            docId,
                            docTitle,
                            chapter,
                            focusMode: summaryFocusMode,
                            annotations,
                            conversations,
                            includeNotes,
                            includeChats,
                        });

                        let chapterOutput = "";
                        await streamPrompt({
                            prompt,
                            systemPrompt,
                            webSearchEnabled,
                            visionImages,
                            signal,
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
                },
                async () => {
                    if (runningMarkdown.trim().length > docTitle.length + 4) {
                        await DocumentDatabase.saveSummary(docId, runningMarkdown).catch(
                            () => { },
                        );
                    }
                },
            );
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
            let accumulated = "";

            await runSummaryTask(
                async (signal) => {
                    const ctx = collectRangeContext(annotations, conversations, {
                        startPage: activeChapter?.startPage,
                        endPage: activeChapter?.endPage,
                        includeNotes,
                        includeChats,
                    });
                    const { enrichedCrops, visionImages } = await resolveCropsForVision(
                        ctx.crops,
                    );
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
                        (t) =>
                            t.name === "add_figure_to_summary" || t.name === "navigate_to",
                    );

                    let pendingToolCalls: LlmToolCall[] = [];
                    await streamPrompt({
                        prompt: basePrompt,
                        systemPrompt,
                        webSearchEnabled,
                        visionImages,
                        tools: summaryTools,
                        signal,
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

                    if (pendingToolCalls.length > 0 && !signal.aborted) {
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
                            await streamPrompt({
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
                                        content: formatToolResultsPrompt(
                                            toolResults,
                                            "Now output the complete updated summary Markdown incorporating the tool results above.",
                                        ),
                                        timestamp: Date.now(),
                                    },
                                ],
                                systemPrompt,
                                webSearchEnabled,
                                visionImages: extraVision,
                                signal,
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
                            activeSummary: { content: accumulated, updatedAt: Date.now() },
                        });
                    }
                },
                async () => {
                    if (!accumulated.trim()) return;
                    await DocumentDatabase.saveSummary(docId, accumulated).catch(() => { });
                    set({
                        activeSummary: { content: accumulated, updatedAt: Date.now() },
                    });
                },
            );
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