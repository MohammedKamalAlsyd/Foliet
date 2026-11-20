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
import { useDocumentStore } from "@/stores/documentStore";
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
    fetchCompressedRangeText,
    prepareChapterPromptData,
    readPreviousSummaryBackup,
    resolveCropsForVision,
    resolvePreviousSnapshot,
    upsertChapterSection,
    writePreviousSummaryBackup,
} from "@/utils/summaryUtils";
import type { CompressionStats } from "@/utils/tokenCompressor";

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
    lastCompressionStats: CompressionStats | null;

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
            await writePreviousSummaryBackup(docId, override);
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
        lastCompressionStats: null,

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
                previousSummary: null,
            });
            try {
                const [summary, backup] = await Promise.all([
                    DocumentDatabase.getSummary(docId),
                    readPreviousSummaryBackup(docId),
                ]);
                if (token !== latestLoadToken) return;
                set({
                    activeSummary: summary,
                    previousSummary: backup,
                    isLoadingSummary: false,
                });
            } catch (err) {
                if (token !== latestLoadToken) return;
                console.warn("SummaryStore: Failed to load summary:", err);
                set({ activeSummary: null, previousSummary: null, isLoadingSummary: false });
            }
        },

        restorePreviousSummary: async (docId) => {
            const backup =
                get().previousSummary ?? (await readPreviousSummaryBackup(docId));
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

            await writePreviousSummaryBackup(docId, nextBackup);
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
                    const {
                        prompt,
                        visionImages,
                        hasNotes,
                        hasChats,
                        hasCrops,
                        compressionStats,
                    } = await prepareChapterPromptData({
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
                    set({ lastCompressionStats: compressionStats });
                    await streamPrompt({
                        prompt,
                        systemPrompt: buildSummarySystemPrompt(summaryFocusMode, docTitle, {
                            includeNotes,
                            includeChats,
                            hasNotes,
                            hasChats,
                            hasCrops,
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
                        const {
                            prompt,
                            visionImages,
                            hasNotes,
                            hasChats,
                            hasCrops,
                            compressionStats,
                        } = await prepareChapterPromptData({
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
                        set({ lastCompressionStats: compressionStats });

                        let chapterOutput = "";
                        await streamPrompt({
                            prompt,
                            systemPrompt: buildSummarySystemPrompt(summaryFocusMode, docTitle, {
                                includeNotes,
                                includeChats,
                                hasNotes,
                                hasChats,
                                hasCrops,
                                webSearchEnabled: activeWebSearch,
                            }),
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
                    const currentChapters = get().chapters;
                    const lastChapterEnd =
                        currentChapters[currentChapters.length - 1]?.endPage;
                    const totalPages =
                        lastChapterEnd ??
                        useDocumentStore.getState().activeDoc?.pages ??
                        (Number(activePdfProxy?.numPages) || 15);
                    const rangeStart = activeChapter?.startPage ?? 1;
                    const rangeEnd = activeChapter?.endPage ?? Math.max(1, totalPages);
                    const stripReferences = !/reference|bibliograph|works cited/i.test(
                        instruction,
                    );
                    const { text: rangeText, stats: compressionStats } =
                        await fetchCompressedRangeText(
                            docId,
                            activePdfProxy,
                            rangeStart,
                            rangeEnd,
                            {
                                maxChars: activeChapter ? 11_500 : 13_500,
                                stripReferences,
                            },
                        );
                    set({ lastCompressionStats: compressionStats });

                    const chapterContext = rangeText.trim()
                        ? {
                            title: activeChapter?.title ?? "Full Document",
                            startPage: rangeStart,
                            endPage: rangeEnd,
                            text: rangeText,
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
                            hasNotes: ctx.highlights.length > 0 || ctx.notes.length > 0,
                            hasChats: ctx.chatTakeaways.length > 0,
                            hasCrops: enrichedCrops.length > 0,
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