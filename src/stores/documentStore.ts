import { create } from "zustand";
import type { DocumentItem } from "@/types/document";

interface DirtySources {
    annotations: boolean;
    bookmarks: boolean;
    crops: boolean;
}

export interface DocumentState {
    activeDoc: DocumentItem | null;
    isViewerOpen: boolean;
    dirtySources: DirtySources;
    isDirty: boolean;
    isSaving: boolean;

    openDocument: (doc: DocumentItem, buffer: ArrayBuffer) => void;
    closeDocument: () => void;
    setDirtySource: (source: keyof DirtySources, dirty: boolean) => void;
    clearDirty: () => void;
    setDocumentIndexed: (isIndexed: boolean) => void;
    setSaveExecutor: (fn: (() => Promise<boolean>) | null) => void;
    saveDocument: () => Promise<boolean>;
}

// Kept outside Zustand subscribers so large PDF buffers don't trigger re-renders
let activePdfBuffer: ArrayBuffer | null = null;
let saveExecutor: (() => Promise<boolean>) | null = null;
let saveSequence = 0;
let inFlightSave: { docId: string; token: number; promise: Promise<boolean> } | null = null;

export const getActivePdfBuffer = (): ArrayBuffer | null => activePdfBuffer;

const CLEAN_DIRTY: DirtySources = {
    annotations: false,
    bookmarks: false,
    crops: false,
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
    activeDoc: null,
    isViewerOpen: false,
    dirtySources: CLEAN_DIRTY,
    isDirty: false,
    isSaving: false,

    openDocument: (doc, buffer) => {
        activePdfBuffer = buffer;
        saveExecutor = null;
        set({
            activeDoc: doc,
            isViewerOpen: true,
            dirtySources: CLEAN_DIRTY,
            isDirty: false,
            isSaving: false,
        });
    },

    closeDocument: () => {
        activePdfBuffer = null;
        saveExecutor = null;
        set({
            activeDoc: null,
            isViewerOpen: false,
            dirtySources: CLEAN_DIRTY,
            isDirty: false,
            isSaving: false,
        });
    },

    setDirtySource: (source, dirty) =>
        set((state) => {
            if (state.dirtySources[source] === dirty) return state;
            const next = { ...state.dirtySources, [source]: dirty };
            return {
                dirtySources: next,
                isDirty: next.annotations || next.bookmarks || next.crops,
            };
        }),

    clearDirty: () => set({ dirtySources: CLEAN_DIRTY, isDirty: false }),

    setDocumentIndexed: (isIndexed) =>
        set((state) => ({
            activeDoc: state.activeDoc ? { ...state.activeDoc, isIndexed } : null,
        })),

    setSaveExecutor: (fn) => {
        saveExecutor = fn;
    },

    saveDocument: async () => {
        const docId = get().activeDoc?.id;
        const executor = saveExecutor;
        if (!docId || !executor) return false;

        if (inFlightSave && inFlightSave.docId === docId) {
            return inFlightSave.promise;
        }

        set({ isSaving: true });
        const token = ++saveSequence;

        const promise = (async () => {
            try {
                const ok = await executor();
                // Only clear dirty state if the same document is still open
                if (ok && get().activeDoc?.id === docId) {
                    get().clearDirty();
                }
                return ok;
            } catch (err) {
                console.error("Save failed:", err);
                return false;
            } finally {
                if (inFlightSave?.token === token) {
                    inFlightSave = null;
                }
                if (get().activeDoc?.id === docId) {
                    set({ isSaving: false });
                }
            }
        })();

        inFlightSave = { docId, token, promise };
        return promise;
    },
}));