/**
 * Foliet - Document Summarization Store
 */

import type { ToolSet } from "ai";
import { create } from "zustand";
import {
    buildSummaryTools,
    LlmService,
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
    buildModifySummaryPrompt,
    buildSummarySystemPrompt,
} from "@/utils/llmPrompts";
import {
    type AiSummaryState,
    collectRangeContext,
    fetchRangeText,
    prepareChapterPromptData,
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

export const useSummaryStore = create<SummaryStore>((set, get) => {
    const captureBackup = async (docId: string, override?: AiSummaryState | null) => {
        if (override?.content?.trim()) {
            writePreviousSummaryBackup(docId, override);
            set({ previousSummary: override });
            return;
        }
        const snapshot = await resolvePreviousSnapshot(docId, get().activeSummary);
        if (snapshot) set({ previousSummary: snapshot });
    };

    const persistSummary = async (
        docId: string,
        content: string,
        sourceSnapshot?: string,
    ) => {
        await DocumentDatabase.saveSummary(docId, content, sourceSnapshot);
        set({ activeSummary: { content, sourceSnapshot, updatedAt: Date.now() } });
    };

    const runStreamedSummaryPipeline = async (opts: {
        docId: string;
        backupOverride?: AiSummaryState | null;
        getPartialContent?: () => { content: string; sourceSnapshot?: string } | null;
        run: (ctx: {
            signal: AbortSignal;
            streamPrompt: (params: {
                prompt: string;
                systemPrompt?: string;
                webSearchEnabled?: boolean;
                visionImages?: VisionImageInput[];
                tools?: ToolSet;
                maxSteps?: number;
                onChunk: (chunk: string) => void;
            }) => Promise<string>;
        }) => Promise<void>;
    }) => {
        await captureBackup(opts.docId, opts.backupOverride);
        activeSummaryAbortController?.abort();
        const controller = new AbortController();
        activeSummaryAbortController = controller;
        set({ isSummarizing: true });

        const streamPrompt = (params: {
            prompt: string;
            systemPrompt?: string;
            webSearchEnabled?: boolean;
            visionImages?: VisionImageInput[];
            tools?: ToolSet;
            maxSteps?: number;
            onChunk: (chunk: string) => void;
        }) => {
            const llm = useAiConfigStore.getState().getActiveLlmConfig();
            return LlmService.streamChat({
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
                maxSteps: params.maxSteps,
                ...llm,
                signal: controller.signal,
                onChunk: params.onChunk,
            });
        };

        try {
            await opts.run({ signal: controller.signal, streamPrompt });
        } catch (err) {
            if (isAbortError(err, controller.signal)) {
                const partial = opts.getPartialContent?.();
                if (partial?.content.trim()) {
                    await persistSummary(
                        opts.docId,
                        partial.content,
                        partial.sourceSnapshot,
                    ).catch(() => { });
                }
                return;
            }
            throw err;
        } finally {
            set({ isSummarizing: false, generationProgress: null });
            if (activeSummaryAbortController === controller) {
                activeSummaryAbortController = null;
            }
        }
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
            const { enrichedCrops, visionImages } = await resolveCropsForVision(input.crops);
            const enrichedInput: StructuredSummaryInput = { ...input, crops: enrichedCrops };
            const sourceSnapshot = JSON.stringify({
                focusMode: enrichedInput.focusMode,
                highlights: enrichedInput.highlights.length,
                notes: enrichedInput.notes.length,
                crops: enrichedInput.crops.length,
                chats: enrichedInput.chatTakeaways.length,
            });
            let accumulated = "";

            await runStreamedSummaryPipeline({
                docId,
                getPartialContent: () =>
                    accumulated.trim() ? { content: accumulated, sourceSnapshot } : null,
                run: async ({ streamPrompt }) => {
                    await streamPrompt({
                        prompt: LlmService.buildStructuredSummarizationPrompt(enrichedInput),
                        visionImages,
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
                    await persistSummary(docId, accumulated, sourceSnapshot);
                },
            });
        },

        generateChapterSummary: async (
            docId,
            {
                docTitle,
                chapter,
                annotations,
                conversations,
                includeNotes = false,
                includeChats = false,
                webSearchEnabled = false,
            },
        ) => {
            const { summaryFocusMode, activeSummary } = get();
            const llm = useAiConfigStore.getState().getActiveLlmConfig();
            const activeWebSearch = llm.provider === "openrouter" && webSearchEnabled;
            const baseMarkdown = activeSummary?.content ?? "";
            let streamedChapter = "";
            const buildMerged = () =>
                upsertChapterSection(baseMarkdown, docTitle, chapter.title, streamedChapter);

            await runStreamedSummaryPipeline({
                docId,
                getPartialContent: () =>
                    streamedChapter.trim() ? { content: buildMerged() } : null,
                run: async ({ streamPrompt }) => {
                    set({
                        generationProgress: { current: 1, total: 1, chapterTitle: chapter.title },
                    });
                    const { prompt, visionImages } = await prepareChapterPromptData({
                        docId,
                        docTitle,
                        chapter,
                        pdfProxy: activePdfProxy,
                        focusMode: summaryFocusMode,
                        annotations,
                        conversations,
                        includeNotes,
                        includeChats,
                        webSearchEnabled: activeWebSearch,
                    });
                    await streamPrompt({
                        prompt,
                        systemPrompt: buildSummarySystemPrompt(summaryFocusMode, docTitle, {
                            includeNotes,
                            includeChats,
                            webSearchEnabled: activeWebSearch,
                        }),
                        webSearchEnabled: activeWebSearch,
                        visionImages,
                        onChunk: (chunk) => {
                            streamedChapter += chunk;
                            set({
                                activeSummary: { content: buildMerged(), updatedAt: Date.now() },
                            });
                        },
                    });
                    await persistSummary(docId, buildMerged());
                },
            });
        },

        generateFullBookSummary: async (
            docId,
            {
                docTitle,
                chapters,
                annotations,
                conversations,
                includeNotes = false,
                includeChats = false,
                webSearchEnabled = false,
            },
        ) => {
            if (chapters.length === 0) return;

            const { summaryFocusMode } = get();
            const llm = useAiConfigStore.getState().getActiveLlmConfig();
            const activeWebSearch = llm.provider === "openrouter" && webSearchEnabled;
            const systemPrompt = buildSummarySystemPrompt(summaryFocusMode, docTitle, {
                includeNotes,
                includeChats,
                webSearchEnabled: activeWebSearch,
            });
            let runningMarkdown = `# ${docTitle}\n`;

            await runStreamedSummaryPipeline({
                docId,
                getPartialContent: () =>
                    runningMarkdown.trim().length > docTitle.length + 4
                        ? { content: runningMarkdown }
                        : null,
                run: async ({ signal, streamPrompt }) => {
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
                            pdfProxy: activePdfProxy,
                            focusMode: summaryFocusMode,
                            annotations,
                            conversations,
                            includeNotes,
                            includeChats,
                            webSearchEnabled: activeWebSearch,
                        });

                        let chapterOutput = "";
                        await streamPrompt({
                            prompt,
                            systemPrompt,
                            webSearchEnabled: activeWebSearch,
                            visionImages,
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
                        await persistSummary(docId, runningMarkdown);
                    }
                },
            });
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
                includeNotes = false,
                includeChats = false,
                webSearchEnabled = false,
            },
        ) => {
            const { summaryFocusMode } = get();
            const llm = useAiConfigStore.getState().getActiveLlmConfig();
            const activeWebSearch = llm.provider === "openrouter" && webSearchEnabled;
            let accumulated = "";
            let resetOnNextChunk = false;

            await runStreamedSummaryPipeline({
                docId,
                backupOverride: existingMarkdown.trim()
                    ? {
                        content: existingMarkdown,
                        sourceSnapshot: get().activeSummary?.sourceSnapshot,
                        updatedAt: get().activeSummary?.updatedAt || Date.now(),
                    }
                    : null,
                getPartialContent: () =>
                    accumulated.trim() ? { content: accumulated } : null,
                run: async ({ streamPrompt }) => {
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

                    await streamPrompt({
                        prompt: buildModifySummaryPrompt({
                            docTitle,
                            focusMode: summaryFocusMode,
                            existingMarkdown,
                            instruction,
                            chapterContext,
                            highlights: ctx.highlights,
                            notes: ctx.notes,
                            crops: enrichedCrops,
                            chatTakeaways: ctx.chatTakeaways,
                            includeNotes,
                            includeChats,
                            webSearchEnabled: activeWebSearch,
                        }),
                        systemPrompt: buildSummarySystemPrompt(summaryFocusMode, docTitle, {
                            includeNotes,
                            includeChats,
                            webSearchEnabled: activeWebSearch,
                        }),
                        webSearchEnabled: activeWebSearch,
                        visionImages,
                        tools: buildSummaryTools({
                            docId,
                            pdfProxy: activePdfProxy,
                            jumpToPage,
                            onToolExecuted: () => {
                                resetOnNextChunk = true;
                            },
                        }),
                        maxSteps: 3,
                        onChunk: (chunk) => {
                            accumulated = resetOnNextChunk
                                ? ((resetOnNextChunk = false), chunk)
                                : accumulated + chunk;
                            set({
                                activeSummary: { content: accumulated, updatedAt: Date.now() },
                            });
                        },
                    });

                    if (accumulated.trim()) {
                        await persistSummary(docId, accumulated);
                    }
                },
            });
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