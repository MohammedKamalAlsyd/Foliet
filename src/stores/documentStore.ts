import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { DocumentItem } from "@/types/document";
import type { PdfAnnotation } from "@/types/annotations";

interface DirtySources {
    annotations: boolean;
    bookmarks: boolean;
    crops: boolean;
}

export interface DocumentState {
    activeDoc: DocumentItem | null;
    dirtySources: DirtySources;
    isDirty: boolean;
    isSaving: boolean;

    openDocument: (doc: DocumentItem) => void;
    setExtractedAnnotations: (docId: string, annotations: PdfAnnotation[]) => void;
    setDocPageCount: (docId: string, pages: number) => void;
    closeDocument: () => void;
    setDirtySource: (source: keyof DirtySources, dirty: boolean) => void;
    clearDirty: () => void;
    setDocumentIndexed: (isIndexed: boolean) => void;
}

/** Streams local PDFs via Rust `foliet-pdf` (HTTP Range / 206 Partial Content) for instant open on large files. */
export const getActivePdfSource = (doc: DocumentItem | null): string | null => {
    if (doc?.filePath) return convertFileSrc(doc.filePath, "foliet-pdf");
    return null;
};

const CLEAN_DIRTY: DirtySources = {
    annotations: false,
    bookmarks: false,
    crops: false,
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
    activeDoc: null,
    dirtySources: CLEAN_DIRTY,
    isDirty: false,
    isSaving: false,

    openDocument: (doc) => {
        set({
            activeDoc: doc,
            dirtySources: CLEAN_DIRTY,
            isDirty: false,
            isSaving: false,
        });
    },

    setExtractedAnnotations: (docId, annotations) =>
        set((state) =>
            state.activeDoc?.id === docId
                ? { activeDoc: { ...state.activeDoc, extractedAnnotations: annotations } }
                : state,
        ),

    setDocPageCount: (docId, pages) =>
        set((state) =>
            state.activeDoc?.id === docId
                ? { activeDoc: { ...state.activeDoc, pages } }
                : state,
        ),

    closeDocument: () => {
        set({
            activeDoc: null,
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
}));