/**
 * Foliet - Document Summarization Store
 *
 * Manages SQLite-backed document summaries, summarization workspace state,
 * focus modes, multimodal figure crop resolution, and abortable LLM synthesis streaming.
 */

import { create } from "zustand";
import {
    LlmService,
    type StructuredSummaryInput,
    type SummaryCropInput,
    type SummaryFocusMode,
    type VisionImageInput,
} from "@/services/llm";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiConfigStore } from "@/stores/aiConfigStore";

export interface AiSummaryState {
    content: string;
    sourceSnapshot?: string;
    updatedAt: number;
}

export interface SummaryStore {
    activeSummary: AiSummaryState | null;
    isLoadingSummary: boolean;
    isSummarizing: boolean;
    isSummaryWorkspaceOpen: boolean;
    summaryFocusMode: SummaryFocusMode;

    setSummaryWorkspaceOpen: (open: boolean) => void;
    setSummaryFocusMode: (mode: SummaryFocusMode) => void;
    loadSummary: (docId: string) => Promise<void>;
    generateStructuredSummary: (docId: string, input: StructuredSummaryInput) => Promise<void>;
    cancelSummaryStreaming: () => void;
    deleteSummary: (docId: string) => Promise<void>;
}

let activeSummaryAbortController: AbortController | null = null;

async function resolveCropsForVision(
    crops: SummaryCropInput[]
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
        })
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

async function streamAndSaveSummary(
    docId: string,
    prompt: string,
    sourceSnapshot: string,
    visionImages: VisionImageInput[],
    set: (partial: Partial<SummaryStore>) => void
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
        console.error("SummaryStore: Structured summarization failed:", err);
        set({ isSummarizing: false });
        throw err;
    } finally {
        if (activeSummaryAbortController === abortController) {
            activeSummaryAbortController = null;
        }
    }
}

export const useSummaryStore = create<SummaryStore>((set) => ({
    activeSummary: null,
    isLoadingSummary: false,
    isSummarizing: false,
    isSummaryWorkspaceOpen: false,
    summaryFocusMode: "study",

    setSummaryWorkspaceOpen: (open) => {
        set({ isSummaryWorkspaceOpen: open });
    },

    setSummaryFocusMode: (mode) => {
        set({ summaryFocusMode: mode });
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

    cancelSummaryStreaming: () => {
        if (activeSummaryAbortController) {
            activeSummaryAbortController.abort();
            activeSummaryAbortController = null;
        }
        set({ isSummarizing: false });
    },

    deleteSummary: async (docId) => {
        await DocumentDatabase.deleteSummary(docId);
        set({ activeSummary: null });
    },
}));