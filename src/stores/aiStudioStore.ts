/**
 * Foliet - AI Studio UI Store
 */

import { create } from "zustand";
import { useChatStore } from "@/stores/chatStore";

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

    setAiStudioOpen: (isAiStudioOpen) => set({ isAiStudioOpen }),
    toggleAiStudio: () => set((s) => ({ isAiStudioOpen: !s.isAiStudioOpen })),
    setActiveAiTab: (activeAiTab) => set({ activeAiTab }),

    askAboutSelection: ({ text, pageNumber, docTitle, docId }) => {
        useChatStore.getState().setPendingContextSnippet({
            chunkId: `selection-${Date.now()}`,
            docId: docId ?? "",
            docTitle: docTitle ?? "Document",
            pageNumber,
            snippet: text.trim(),
        });
        set({ isAiStudioOpen: true, activeAiTab: "chat" });
    },
}));