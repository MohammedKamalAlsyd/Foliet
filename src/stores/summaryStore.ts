/**
 * Foliet - Document Summarization Store
 *
 * Manages SQLite-backed document summaries, summarization workspace state,
 * focus modes, and abortable LLM synthesis streaming.
 */

import { create } from "zustand";
import {
    LlmService,
    type StructuredSummaryInput,
    type SummaryFocusMode,
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

async function streamAndSaveSummary(
    docId: string,
    prompt: string,
    sourceSnapshot: string,
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
        const snapshot = JSON.stringify({
            focusMode: input.focusMode,
            highlights: input.highlights.length,
            notes: input.notes.length,
            crops: input.crops.length,
            chats: input.chatTakeaways.length,
        });
        const prompt = LlmService.buildStructuredSummarizationPrompt(input);
        await streamAndSaveSummary(docId, prompt, snapshot, set);
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