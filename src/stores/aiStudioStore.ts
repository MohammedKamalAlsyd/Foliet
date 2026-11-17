/**
 * Foliet - AI Studio UI Store
 *
 * Manages right-sidebar visibility, active studio tab, and selection handoff.
 */

import { create } from "zustand";
import { useChatStore } from "@/stores/chatStore";
import type { CitationReference } from "@/types/chat";

export type AiStudioTab = "chat" | "search" | "chunks" | "summary" | "settings";

export interface AiStudioStore {
    isAiStudioOpen: boolean;
    activeAiTab: AiStudioTab;
    setAiStudioOpen: (open: boolean) => void;
    toggleAiStudio: () => void;
    setActiveAiTab: (tab: AiStudioTab) => void;
    askAboutSelection: (selection: {
        text: string;
        pageNumber: number;
        docTitle?: string;
        docId?: string;
    }) => void;
}

export const useAiStudioStore = create<AiStudioStore>((set) => ({
    isAiStudioOpen: false,
    activeAiTab: "chat",

    setAiStudioOpen: (open) => {
        set({ isAiStudioOpen: open });
    },

    toggleAiStudio: () => {
        set((state) => ({ isAiStudioOpen: !state.isAiStudioOpen }));
    },

    setActiveAiTab: (tab) => {
        set({ activeAiTab: tab });
    },

    askAboutSelection: ({ text, pageNumber, docTitle, docId }) => {
        const citation: CitationReference = {
            chunkId: `selection-${Date.now()}`,
            docId: docId ?? "",
            docTitle: docTitle ?? "Document",
            pageNumber,
            snippet: text.trim(),
        };
        useChatStore.getState().setPendingContextSnippet(citation);
        set({
            isAiStudioOpen: true,
            activeAiTab: "chat",
        });
    },
}));