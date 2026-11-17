/**
 * Foliet - Document Summarization Store
 *
 * Manages SQLite-backed Living Summaries, chapter-by-chapter and full-book synthesis,
 * conversational Markdown refinement, system-prompt style presets, optional context
 * toggles (notes, chats, web search), multimodal figure resolution, and tool calls.
 */

import { create } from "zustand";
import { captureFigureCropFromPage } from "@/services/figureCropper";
import {
    FOLIET_TOOL_DEFINITIONS,
    LlmService,
    type LlmToolCall,
    type StructuredSummaryInput,
    type SummaryChatTakeawayInput,
    type SummaryCropInput,
    type SummaryFocusMode,
    type SummaryHighlightInput,
    type SummaryNoteInput,
    type VisionImageInput,
} from "@/services/llm";
import { PdfService } from "@/services/pdf";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import {
    isCropAnnotation,
    isNoteAnnotation,
    isTextMarkupAnnotation,
    type PdfAnnotation,
} from "@/types/annotations";
import type { ChatConversation } from "@/types/chat";
import type { PdfChapter } from "@/types/document";

export interface AiSummaryState {
    content: string;
    sourceSnapshot?: string;
    updatedAt: number;
}

export interface SummaryGenerationProgress {
    current: number;
    total: number;
    chapterTitle: string;
}

export interface ChapterGenerationParams {
    docTitle: string;
    chapter: PdfChapter;
    annotations: PdfAnnotation[];
    conversations: ChatConversation[];
}

export interface FullBookGenerationParams {
    docTitle: string;
    chapters: PdfChapter[];
    annotations: PdfAnnotation[];
    conversations: ChatConversation[];
}

export interface ModifySummaryParams {
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
    isLoadingSummary: boolean;
    isSummarizing: boolean;
    isSummaryWorkspaceOpen: boolean;
    summaryFocusMode: SummaryFocusMode;

    chapters: PdfChapter[];
    selectedChapterId: string;
    generationProgress: SummaryGenerationProgress | null;
    includeNotes: boolean;
    includeChats: boolean;
    summaryWebSearch: boolean;
    pdfProxy: any | null;

    setSummaryWorkspaceOpen: (open: boolean) => void;
    setSummaryFocusMode: (mode: SummaryFocusMode) => void;
    setChapters: (chapters: PdfChapter[]) => void;
    setSelectedChapterId: (id: string) => void;
    setIncludeNotes: (enabled: boolean) => void;
    setIncludeChats: (enabled: boolean) => void;
    setSummaryWebSearch: (enabled: boolean) => void;
    setPdfProxy: (proxy: any | null) => void;
    updateActiveSummaryLocal: (content: string) => void;

    loadSummary: (docId: string) => Promise<void>;
    generateStructuredSummary: (docId: string, input: StructuredSummaryInput) => Promise<void>;
    generateChapterSummary: (docId: string, params: ChapterGenerationParams) => Promise<void>;
    generateFullBookSummary: (docId: string, params: FullBookGenerationParams) => Promise<void>;
    modifySummaryWithInstruction: (docId: string, params: ModifySummaryParams) => Promise<void>;
    cancelSummaryStreaming: () => void;
    deleteSummary: (docId: string) => Promise<void>;
}

let activeSummaryAbortController: AbortController | null = null;

async function resolveCropsForVision(
    crops: SummaryCropInput[],
): Promise<{
    enrichedCrops: SummaryCropInput[];
    visionImages: VisionImageInput[];
}> {
    if (crops.length === 0) {
        return { enrichedCrops: crops, visionImages: [] };
    }

    const enrichedCrops = await Promise.all(
        crops.map(async (crop) => {
            if (crop.resolvedDataUrl?.startsWith("data:")) {
                return crop;
            }
            if (crop.imageUrl.startsWith("data:")) {
                return { ...crop, resolvedDataUrl: crop.imageUrl };
            }
            if (
                crop.imageUrl.startsWith("idb://") ||
                crop.imageUrl.startsWith("db://") ||
                crop.imageUrl.startsWith("crop-")
            ) {
                try {
                    const dataUrl = await DocumentDatabase.getFigureCrop(crop.imageUrl);
                    if (dataUrl && dataUrl.startsWith("data:")) {
                        return { ...crop, resolvedDataUrl: dataUrl };
                    }
                } catch {
                    // Fall back to URI/caption-only reference if crop fetch fails
                }
            }
            return crop;
        }),
    );

    const visionImages: VisionImageInput[] = enrichedCrops
        .filter((c) => Boolean(c.resolvedDataUrl))
        .map((c) => ({
            dataUrl: c.resolvedDataUrl as string,
            caption: c.caption
                ? `Page ${c.pageNumber}: ${c.caption}`
                : `Figure crop from Page ${c.pageNumber} (${c.imageUrl})`,
        }));

    return { enrichedCrops, visionImages };
}

function collectRangeContext(
    annotations: PdfAnnotation[],
    conversations: ChatConversation[],
    options: {
        startPage?: number;
        endPage?: number;
        includeNotes: boolean;
        includeChats: boolean;
    },
): {
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
} {
    const inRange = (page: number) =>
        options.startPage === undefined ||
        options.endPage === undefined ||
        (page >= options.startPage && page <= options.endPage);

    const highlights: SummaryHighlightInput[] = [];
    const notes: SummaryNoteInput[] = [];
    const crops: SummaryCropInput[] = [];

    for (const a of annotations) {
        if (!inRange(a.pageNumber)) continue;

        if (isCropAnnotation(a)) {
            crops.push({
                id: a.id,
                pageNumber: a.pageNumber,
                imageUrl: a.imageUrl.startsWith("idb://") ? a.imageUrl : `idb://${a.id}`,
                caption: a.caption,
            });
        } else if (options.includeNotes) {
            if (isTextMarkupAnnotation(a) && a.text.trim()) {
                highlights.push({
                    pageNumber: a.pageNumber,
                    toolType: a.toolType,
                    text: a.text,
                });
            } else if (isNoteAnnotation(a) && a.comment.trim()) {
                notes.push({
                    pageNumber: a.pageNumber,
                    comment: a.comment,
                    contextSnippet: a.contextSnippet,
                });
            }
        }
    }

    const chatTakeaways: SummaryChatTakeawayInput[] = options.includeChats
        ? conversations
            .filter((c) => c.messages.length > 0)
            .slice(0, 6)
            .map((c) => ({
                title: c.title,
                excerpts: c.messages
                    .filter((m) => m.content.trim().length > 0)
                    .slice(-6)
                    .map(
                        (m) =>
                            `${m.role === "user" ? "Question" : "Lio"}: ${m.content
                                .trim()
                                .slice(0, 600)}`,
                    ),
            }))
        : [];

    return { highlights, notes, crops, chatTakeaways };
}

async function fetchRangeText(
    docId: string,
    pdfProxy: any | null,
    startPage: number,
    endPage: number,
): Promise<string> {
    try {
        const chunks = await RagService.getDocumentChunks(docId);
        const rangeChunks = chunks
            .filter((c) => c.pageNumber >= startPage && c.pageNumber <= endPage)
            .sort((a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex);

        if (rangeChunks.length > 0) {
            const joined = rangeChunks
                .map((c) => `[Page ${c.pageNumber}] ${c.text.trim()}`)
                .join("\n\n");
            if (joined.length <= 20_000) return joined;
            return joined.slice(0, 20_000);
        }
    } catch {
        // Fall back to direct PDF text extraction below
    }

    return PdfService.extractPageRangeText(pdfProxy, startPage, endPage, 18_000);
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ensureChapterHeading(sectionMd: string, chapterTitle: string): string {
    const trimmed = sectionMd.trim();
    if (!trimmed) return `## ${chapterTitle}\n`;
    if (/^##\s+/m.test(trimmed)) return trimmed;
    return `## ${chapterTitle}\n\n${trimmed}`;
}

/**
 * Replaces an existing `## <chapterTitle>` block inside `existingMarkdown`,
 * or appends it cleanly if not yet present.
 */
function upsertChapterSection(
    existingMarkdown: string,
    docTitle: string,
    chapterTitle: string,
    sectionContent: string,
): string {
    const base = existingMarkdown.trim();
    const cleanSection = ensureChapterHeading(sectionContent, chapterTitle);

    if (!base) {
        return `# ${docTitle}\n\n${cleanSection}\n`;
    }

    const headingRe = new RegExp(
        `^##\\s+${escapeRegExp(chapterTitle.trim())}\\s*$`,
        "im",
    );
    const match = headingRe.exec(base);

    if (!match) {
        return `${base}\n\n${cleanSection}\n`;
    }

    const startIdx = match.index;
    const afterHeadingIdx = startIdx + match[0].length;
    const rest = base.slice(afterHeadingIdx);
    const nextHeadingMatch = /^##\s+/m.exec(rest);
    const endIdx = nextHeadingMatch
        ? afterHeadingIdx + nextHeadingMatch.index
        : base.length;

    const before = base.slice(0, startIdx).trimEnd();
    const after = base.slice(endIdx).trimStart();

    return [before, cleanSection, after].filter(Boolean).join("\n\n") + "\n";
}

async function streamAndSaveSummary(
    docId: string,
    prompt: string,
    sourceSnapshot: string,
    visionImages: VisionImageInput[],
    set: (partial: Partial<SummaryStore>) => void,
    options?: { systemPrompt?: string; webSearchEnabled?: boolean },
): Promise<void> {
    if (activeSummaryAbortController) {
        activeSummaryAbortController.abort();
        activeSummaryAbortController = null;
    }

    const abortController = new AbortController();
    activeSummaryAbortController = abortController;

    set({ isSummarizing: true });
    let accumulated = "";

    try {
        const { llmProvider: provider, llmModel: model, apiKeys, ollamaEndpoint } =
            useAiConfigStore.getState();
        const apiKey = apiKeys[provider] ?? "";

        await LlmService.streamChat({
            messages: [
                {
                    id: crypto.randomUUID(),
                    role: "user",
                    content: prompt,
                    timestamp: Date.now(),
                },
            ],
            systemPrompt: options?.systemPrompt,
            webSearchEnabled:
                provider === "openrouter" ? Boolean(options?.webSearchEnabled) : false,
            visionImages: visionImages.length > 0 ? visionImages : undefined,
            provider,
            model,
            apiKey,
            ollamaEndpoint,
            signal: abortController.signal,
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
    } catch (err: any) {
        const isAborted = err?.name === "AbortError" || abortController.signal.aborted;
        if (isAborted) {
            if (accumulated.trim().length > 0) {
                await DocumentDatabase.saveSummary(docId, accumulated, sourceSnapshot).catch(() => { });
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
        console.error("SummaryStore: Summarization failed:", err);
        set({ isSummarizing: false });
        throw err;
    } finally {
        if (activeSummaryAbortController === abortController) {
            activeSummaryAbortController = null;
        }
    }
}

export const useSummaryStore = create<SummaryStore>((set, get) => ({
    activeSummary: null,
    isLoadingSummary: false,
    isSummarizing: false,
    isSummaryWorkspaceOpen: false,
    summaryFocusMode: "study",

    chapters: [],
    selectedChapterId: "all",
    generationProgress: null,
    includeNotes: true,
    includeChats: false,
    summaryWebSearch: false,
    pdfProxy: null,

    setSummaryWorkspaceOpen: (open) => {
        set({ isSummaryWorkspaceOpen: open });
    },

    setSummaryFocusMode: (mode) => {
        set({ summaryFocusMode: mode });
    },

    setChapters: (chapters) => {
        set((state) => {
            const validSelection =
                state.selectedChapterId === "all" ||
                chapters.some((c) => c.id === state.selectedChapterId);
            return {
                chapters,
                selectedChapterId: validSelection ? state.selectedChapterId : "all",
            };
        });
    },

    setSelectedChapterId: (id) => {
        set({ selectedChapterId: id });
    },

    setIncludeNotes: (enabled) => {
        set({ includeNotes: enabled });
    },

    setIncludeChats: (enabled) => {
        set({ includeChats: enabled });
    },

    setSummaryWebSearch: (enabled) => {
        set({ summaryWebSearch: enabled });
    },

    setPdfProxy: (proxy) => {
        set({ pdfProxy: proxy });
    },

    updateActiveSummaryLocal: (content) => {
        set((state) => ({
            activeSummary: {
                content,
                sourceSnapshot: state.activeSummary?.sourceSnapshot,
                updatedAt: Date.now(),
            },
        }));
    },

    loadSummary: async (docId) => {
        set({ isLoadingSummary: true });
        try {
            const summary = await DocumentDatabase.getSummary(docId);
            set({ activeSummary: summary, isLoadingSummary: false });
        } catch (err) {
            console.warn("SummaryStore: Failed to load summary:", err);
            set({ activeSummary: null, isLoadingSummary: false });
        }
    },

    generateStructuredSummary: async (docId, input) => {
        const { enrichedCrops, visionImages } = await resolveCropsForVision(input.crops);
        const enrichedInput: StructuredSummaryInput = {
            ...input,
            crops: enrichedCrops,
        };

        const snapshot = JSON.stringify({
            focusMode: enrichedInput.focusMode,
            highlights: enrichedInput.highlights.length,
            notes: enrichedInput.notes.length,
            crops: enrichedInput.crops.length,
            chats: enrichedInput.chatTakeaways.length,
        });
        const prompt = LlmService.buildStructuredSummarizationPrompt(enrichedInput);
        await streamAndSaveSummary(docId, prompt, snapshot, visionImages, set);
    },

    generateChapterSummary: async (docId, { docTitle, chapter, annotations, conversations }) => {
        if (activeSummaryAbortController) {
            activeSummaryAbortController.abort();
            activeSummaryAbortController = null;
        }

        const abortController = new AbortController();
        activeSummaryAbortController = abortController;

        const {
            summaryFocusMode,
            includeNotes,
            includeChats,
            summaryWebSearch,
            pdfProxy,
            activeSummary,
        } = get();

        const baseMarkdown = activeSummary?.content ?? "";
        set({
            isSummarizing: true,
            generationProgress: {
                current: 1,
                total: 1,
                chapterTitle: chapter.title,
            },
        });

        let streamedChapter = "";
        try {
            const chapterText = await fetchRangeText(
                docId,
                pdfProxy,
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

            const systemPrompt = LlmService.buildSummarySystemPrompt(
                summaryFocusMode,
                docTitle,
            );
            const userPrompt = LlmService.buildChapterSummaryPrompt({
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
            });

            const { llmProvider: provider, llmModel: model, apiKeys, ollamaEndpoint } =
                useAiConfigStore.getState();
            const apiKey = apiKeys[provider] ?? "";

            await LlmService.streamChat({
                messages: [
                    {
                        id: crypto.randomUUID(),
                        role: "user",
                        content: userPrompt,
                        timestamp: Date.now(),
                    },
                ],
                systemPrompt,
                webSearchEnabled: provider === "openrouter" && summaryWebSearch,
                visionImages: visionImages.length > 0 ? visionImages : undefined,
                provider,
                model,
                apiKey,
                ollamaEndpoint,
                signal: abortController.signal,
                onChunk: (chunk) => {
                    streamedChapter += chunk;
                    const merged = upsertChapterSection(
                        baseMarkdown,
                        docTitle,
                        chapter.title,
                        streamedChapter,
                    );
                    set({
                        activeSummary: {
                            content: merged,
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
                activeSummary: {
                    content: finalContent,
                    updatedAt: Date.now(),
                },
            });
        } catch (err: any) {
            const isAborted =
                err?.name === "AbortError" || abortController.signal.aborted;
            if (isAborted) {
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
            if (activeSummaryAbortController === abortController) {
                activeSummaryAbortController = null;
            }
        }
    },

    generateFullBookSummary: async (
        docId,
        { docTitle, chapters, annotations, conversations },
    ) => {
        if (chapters.length === 0) return;

        if (activeSummaryAbortController) {
            activeSummaryAbortController.abort();
            activeSummaryAbortController = null;
        }

        const abortController = new AbortController();
        activeSummaryAbortController = abortController;

        const {
            summaryFocusMode,
            includeNotes,
            includeChats,
            summaryWebSearch,
            pdfProxy,
        } = get();

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
            const { llmProvider: provider, llmModel: model, apiKeys, ollamaEndpoint } =
                useAiConfigStore.getState();
            const apiKey = apiKeys[provider] ?? "";
            const systemPrompt = LlmService.buildSummarySystemPrompt(
                summaryFocusMode,
                docTitle,
            );

            for (let i = 0; i < chapters.length; i++) {
                if (abortController.signal.aborted) break;

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
                    pdfProxy,
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

                const userPrompt = LlmService.buildChapterSummaryPrompt({
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
                });

                let chapterOutput = "";
                await LlmService.streamChat({
                    messages: [
                        {
                            id: crypto.randomUUID(),
                            role: "user",
                            content: userPrompt,
                            timestamp: Date.now(),
                        },
                    ],
                    systemPrompt,
                    webSearchEnabled: provider === "openrouter" && summaryWebSearch,
                    visionImages: visionImages.length > 0 ? visionImages : undefined,
                    provider,
                    model,
                    apiKey,
                    ollamaEndpoint,
                    signal: abortController.signal,
                    onChunk: (chunk) => {
                        chapterOutput += chunk;
                        const preview = upsertChapterSection(
                            runningMarkdown,
                            docTitle,
                            chapter.title,
                            chapterOutput,
                        );
                        set({
                            activeSummary: {
                                content: preview,
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
        } catch (err: any) {
            const isAborted =
                err?.name === "AbortError" || abortController.signal.aborted;
            if (isAborted) {
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
            if (activeSummaryAbortController === abortController) {
                activeSummaryAbortController = null;
            }
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
        },
    ) => {
        if (activeSummaryAbortController) {
            activeSummaryAbortController.abort();
            activeSummaryAbortController = null;
        }

        const abortController = new AbortController();
        activeSummaryAbortController = abortController;

        const {
            summaryFocusMode,
            includeNotes,
            includeChats,
            summaryWebSearch,
            pdfProxy,
        } = get();

        set({
            isSummarizing: true,
            generationProgress: null,
        });

        let accumulated = "";
        try {
            const ctx = collectRangeContext(annotations, conversations, {
                startPage: activeChapter?.startPage,
                endPage: activeChapter?.endPage,
                includeNotes,
                includeChats,
            });
            const { enrichedCrops, visionImages } = await resolveCropsForVision(
                ctx.crops,
            );

            let chapterContext:
                | { title: string; startPage: number; endPage: number; text: string }
                | undefined;

            if (activeChapter) {
                const text = await fetchRangeText(
                    docId,
                    pdfProxy,
                    activeChapter.startPage,
                    activeChapter.endPage,
                );
                chapterContext = {
                    title: activeChapter.title,
                    startPage: activeChapter.startPage,
                    endPage: activeChapter.endPage,
                    text,
                };
            }

            const systemPrompt = LlmService.buildSummarySystemPrompt(
                summaryFocusMode,
                docTitle,
            );
            const baseUserPrompt = LlmService.buildModifySummaryPrompt({
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

            const { llmProvider: provider, llmModel: model, apiKeys, ollamaEndpoint } =
                useAiConfigStore.getState();
            const apiKey = apiKeys[provider] ?? "";

            const summaryTools = FOLIET_TOOL_DEFINITIONS.filter(
                (t) => t.name === "add_figure_to_summary" || t.name === "navigate_to",
            );

            let pendingToolCalls: LlmToolCall[] = [];
            let roundMessages: Array<{
                id: string;
                role: "user" | "assistant";
                content: string;
                timestamp: number;
            }> = [
                    {
                        id: crypto.randomUUID(),
                        role: "user",
                        content: baseUserPrompt,
                        timestamp: Date.now(),
                    },
                ];

            await LlmService.streamChat({
                messages: roundMessages,
                systemPrompt,
                webSearchEnabled: provider === "openrouter" && summaryWebSearch,
                visionImages: visionImages.length > 0 ? visionImages : undefined,
                tools: summaryTools,
                provider,
                model,
                apiKey,
                ollamaEndpoint,
                signal: abortController.signal,
                onToolCalls: (calls) => {
                    pendingToolCalls = calls;
                },
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

            // Handle tool invocations (e.g. `add_figure_to_summary`) and follow up
            if (pendingToolCalls.length > 0 && !abortController.signal.aborted) {
                const toolResults: string[] = [];
                const extraVision: VisionImageInput[] = [...visionImages];

                for (const call of pendingToolCalls) {
                    if (call.name === "add_figure_to_summary") {
                        const pageNum = Math.max(
                            1,
                            Math.round(Number(call.arguments?.pageNumber) || 1),
                        );
                        const caption =
                            typeof call.arguments?.caption === "string"
                                ? call.arguments.caption.trim()
                                : undefined;
                        const captured = await captureFigureCropFromPage(
                            pageNum,
                            caption,
                            { docId, jumpToPage },
                        );
                        if (captured) {
                            const uri = captured.crop.imageUrl.startsWith("idb://")
                                ? captured.crop.imageUrl
                                : `idb://${captured.crop.id}`;
                            const alt =
                                captured.crop.caption || `Figure (Page ${pageNum})`;
                            const dataUrl = await DocumentDatabase.getFigureCrop(uri);
                            if (dataUrl) {
                                extraVision.push({
                                    dataUrl,
                                    caption: `Page ${pageNum}: ${alt}`,
                                });
                            }
                            toolResults.push(
                                `Captured figure on Page ${pageNum}. Embed it in the updated Markdown using: ![${alt}](${uri})`,
                            );
                        } else {
                            toolResults.push(
                                `Could not capture figure on Page ${pageNum}.`,
                            );
                        }
                    } else if (call.name === "navigate_to") {
                        const pageNum = Math.max(
                            1,
                            Math.round(Number(call.arguments?.pageNumber) || 1),
                        );
                        jumpToPage?.(pageNum);
                        const text = await fetchRangeText(
                            docId,
                            pdfProxy,
                            pageNum,
                            pageNum,
                        );
                        toolResults.push(
                            text
                                ? `Page ${pageNum} text:\n${text}`
                                : `Navigated to Page ${pageNum}.`,
                        );
                    }
                }

                if (toolResults.length > 0) {
                    accumulated = "";
                    roundMessages = [
                        ...roundMessages,
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
                    ];

                    await LlmService.streamChat({
                        messages: roundMessages,
                        systemPrompt,
                        webSearchEnabled:
                            provider === "openrouter" && summaryWebSearch,
                        visionImages:
                            extraVision.length > 0 ? extraVision : undefined,
                        provider,
                        model,
                        apiKey,
                        ollamaEndpoint,
                        signal: abortController.signal,
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

            if (accumulated.trim().length > 0) {
                await DocumentDatabase.saveSummary(docId, accumulated);
                set({
                    isSummarizing: false,
                    activeSummary: {
                        content: accumulated,
                        updatedAt: Date.now(),
                    },
                });
            } else {
                set({ isSummarizing: false });
            }
        } catch (err: any) {
            const isAborted =
                err?.name === "AbortError" || abortController.signal.aborted;
            if (isAborted) {
                if (accumulated.trim().length > 0) {
                    await DocumentDatabase.saveSummary(docId, accumulated).catch(
                        () => { },
                    );
                    set({
                        isSummarizing: false,
                        activeSummary: {
                            content: accumulated,
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
            if (activeSummaryAbortController === abortController) {
                activeSummaryAbortController = null;
            }
        }
    },

    cancelSummaryStreaming: () => {
        if (activeSummaryAbortController) {
            activeSummaryAbortController.abort();
            activeSummaryAbortController = null;
        }
        set({ isSummarizing: false, generationProgress: null });
    },

    deleteSummary: async (docId) => {
        await DocumentDatabase.deleteSummary(docId);
        set({ activeSummary: null });
    },
}));