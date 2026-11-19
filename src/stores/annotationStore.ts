import { create, useStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal, type TemporalState } from "zundo";
import { toast } from "sonner";
import { clearResolvedCropCache } from "@/services/cropResolver";
import { PdfService } from "@/services/pdf";
import { DocumentCatalogStorage } from "@/services/storage/catalog";
import { DocumentDatabase } from "@/services/storage/database";
import { useDocumentStore } from "@/stores/documentStore";
import { useLibraryStore } from "@/stores/libraryStore";
import {
    type BurnableAnnotation,
    type CropAnnotation,
    type PdfAnnotation,
    isCropAnnotation,
} from "@/types/annotations";
import type { BookmarkItem } from "@/types/document";

interface DirtySources {
    annotations: boolean;
    bookmarks: boolean;
    crops: boolean;
}

const sameBookmarks = (a: BookmarkItem[], b: BookmarkItem[]) =>
    a === b ||
    (a.length === b.length &&
        a.every(
            (x, i) =>
                x.id === b[i].id &&
                x.pageNumber === b[i].pageNumber &&
                x.title === b[i].title,
        ));

const sameCrops = (a: CropAnnotation[], b: CropAnnotation[]) =>
    a === b || (a.length === b.length && a.every((x, i) => x.id === b[i].id));

const sameAnnotations = (a: PdfAnnotation[], b: PdfAnnotation[]) =>
    a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

export interface AnnotationState {
    docId: string | null;
    annotations: PdfAnnotation[];
    cropAnnotations: CropAnnotation[];
    bookmarks: BookmarkItem[];
    savedAnnotations: PdfAnnotation[];
    savedBookmarks: BookmarkItem[];
    savedCrops: CropAnnotation[];
    dirtySources: DirtySources;
    isDirty: boolean;
    hasEditedAnnotations: boolean;
    seededDocId: string | null;
    editingNoteId: string | null;
    noteAnchorPos: { x: number; y: number } | null;

    loadForDocument: (docId: string, fallbackAnnots?: PdfAnnotation[]) => Promise<void>;
    addAnnotation: (annot: PdfAnnotation) => void;
    updateAnnotation: (annot: PdfAnnotation) => void;
    deleteAnnotation: (id: string) => void;
    addCrop: (
        crop: {
            pageNumber: number;
            imageUrl: string;
            x: number;
            y: number;
            width: number;
            height: number;
            caption?: string;
        },
        docId?: string,
    ) => Promise<CropAnnotation | undefined>;
    deleteCrop: (id: string, docId?: string) => Promise<void>;
    receiveCrop: (crop: CropAnnotation, docId?: string) => void;
    receiveAnnotation: (annot: PdfAnnotation, docId?: string) => void;
    toggleBookmark: (pageNumber: number, title?: string) => void;
    deleteBookmark: (id: string) => void;
    setExtractedAnnotations: (extracted: PdfAnnotation[]) => void;
    setEditingNote: (id: string | null, pos?: { x: number; y: number } | null) => void;
    saveAndBurn: (
        filePath?: string,
        readingPos?: { lastPage: number; zoom: number; pageCount: number },
    ) => Promise<boolean>;
    clear: () => void;
}

export const useAnnotationStore = create<AnnotationState>()(
    temporal(
        immer((set, get) => ({
            docId: null,
            annotations: [],
            cropAnnotations: [],
            bookmarks: [],
            savedAnnotations: [],
            savedBookmarks: [],
            savedCrops: [],
            dirtySources: { annotations: false, bookmarks: false, crops: false },
            isDirty: false,
            hasEditedAnnotations: false,
            seededDocId: null,
            editingNoteId: null,
            noteAnchorPos: null,

            loadForDocument: async (docId, fallbackAnnots) => {
                set((state) => {
                    state.docId = docId;
                    state.editingNoteId = null;
                    state.noteAnchorPos = null;
                    state.hasEditedAnnotations = false;
                    state.seededDocId = null;
                });

                try {
                    const [savedAnnots, savedBookmarks] = await Promise.all([
                        DocumentDatabase.getAnnotations(docId),
                        DocumentDatabase.getBookmarks(docId),
                    ]);

                    const source = savedAnnots.length > 0 ? savedAnnots : (fallbackAnnots ?? []);
                    const nonCrop = source.filter((a) => !isCropAnnotation(a));
                    const crops = source.filter(isCropAnnotation);

                    set((state) => {
                        state.annotations = nonCrop;
                        state.savedAnnotations = nonCrop;
                        state.cropAnnotations = crops;
                        state.savedCrops = crops;
                        state.bookmarks = savedBookmarks;
                        state.savedBookmarks = savedBookmarks;
                        if (savedAnnots.length > 0 || fallbackAnnots?.length) {
                            state.seededDocId = docId;
                        }
                    });

                    useAnnotationStore.temporal.getState().clear();
                    useDocumentStore.getState().clearDirty();
                } catch {
                    toast.error("Failed to load saved annotations");
                }
            },

            addAnnotation: (annot) =>
                set((state) => {
                    state.hasEditedAnnotations = true;
                    state.annotations.push(annot);
                }),

            updateAnnotation: (annot) =>
                set((state) => {
                    state.hasEditedAnnotations = true;
                    const idx = state.annotations.findIndex((a) => a.id === annot.id);
                    if (idx !== -1) {
                        state.annotations[idx] = annot;
                    }
                }),

            deleteAnnotation: (id) =>
                set((state) => {
                    state.hasEditedAnnotations = true;
                    state.annotations = state.annotations.filter((a) => a.id !== id);
                }),

            addCrop: async (crop, targetDocId) => {
                const docId = targetDocId ?? get().docId;
                if (!docId) return undefined;
                const id = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const created: CropAnnotation = {
                    id,
                    pageNumber: crop.pageNumber,
                    toolType: "area_select",
                    color: "#06B6D4",
                    imageUrl: `idb://${id}`,
                    ...(crop.caption ? { caption: crop.caption } : {}),
                    createdAt: new Date().toISOString(),
                    x: crop.x,
                    y: crop.y,
                    width: crop.width,
                    height: crop.height,
                };

                await Promise.all([
                    DocumentDatabase.saveFigureCrop(id, crop.imageUrl, docId),
                    DocumentDatabase.appendAnnotation(docId, created),
                ]);

                set((state) => {
                    state.cropAnnotations.unshift(created);
                    state.savedCrops.unshift(created);
                });
                toast.success("Figure captured");
                return created;
            },

            deleteCrop: async (id, targetDocId) => {
                const docId = targetDocId ?? get().docId;
                clearResolvedCropCache(id);
                await Promise.all([
                    DocumentDatabase.deleteFigureCrop(id),
                    docId ? DocumentDatabase.removeAnnotation(docId, id) : Promise.resolve(),
                ]);
                set((state) => {
                    state.cropAnnotations = state.cropAnnotations.filter((c) => c.id !== id);
                    state.savedCrops = state.savedCrops.filter((c) => c.id !== id);
                });
            },

            receiveCrop: (crop, targetDocId) => {
                const currentDocId = get().docId;
                if (targetDocId && currentDocId && targetDocId !== currentDocId) return;
                set((state) => {
                    if (!state.cropAnnotations.some((c) => c.id === crop.id)) {
                        state.cropAnnotations.unshift(crop);
                        state.savedCrops.unshift(crop);
                    }
                });
            },

            receiveAnnotation: (annot, targetDocId) => {
                const currentDocId = get().docId;
                if (targetDocId && currentDocId && targetDocId !== currentDocId) return;
                if (isCropAnnotation(annot)) return;
                set((state) => {
                    if (!state.annotations.some((a) => a.id === annot.id)) {
                        state.annotations.push(annot);
                        state.hasEditedAnnotations = true;
                    }
                });
            },

            toggleBookmark: (pageNumber, title) =>
                set((state) => {
                    const idx = state.bookmarks.findIndex((b) => b.pageNumber === pageNumber);
                    if (idx !== -1) {
                        state.bookmarks.splice(idx, 1);
                    } else {
                        state.bookmarks.push({
                            id: `bm-${Date.now()}`,
                            pageNumber,
                            title: title ?? `Page ${pageNumber}`,
                            createdAt: new Date().toISOString(),
                        });
                    }
                }),

            deleteBookmark: (id) =>
                set((state) => {
                    state.bookmarks = state.bookmarks.filter((b) => b.id !== id);
                }),

            setExtractedAnnotations: (extracted) => {
                const state = get();
                if (
                    !state.docId ||
                    state.seededDocId === state.docId ||
                    state.hasEditedAnnotations ||
                    !extracted.length ||
                    state.dirtySources.annotations
                ) {
                    return;
                }
                const nonCrop = extracted.filter((a) => !isCropAnnotation(a));
                set((s) => {
                    s.seededDocId = s.docId;
                    s.annotations = nonCrop;
                    s.savedAnnotations = nonCrop;
                });
                useAnnotationStore.temporal.getState().clear();
            },

            setEditingNote: (id, pos = null) =>
                set((state) => {
                    state.editingNoteId = id;
                    state.noteAnchorPos = pos;
                }),

            saveAndBurn: async (filePath, readingPos) => {
                const docId = get().docId;
                if (!docId) return false;

                try {
                    const { annotations, cropAnnotations, bookmarks } = get();
                    const burnableAnnotations = annotations.filter(
                        (a): a is BurnableAnnotation => a.toolType !== "area_select",
                    );

                    const promises: Promise<unknown>[] = [
                        DocumentDatabase.saveAnnotations(docId, [...annotations, ...cropAnnotations]),
                        DocumentDatabase.saveBookmarks(docId, bookmarks),
                    ];

                    if (readingPos) {
                        const meta = {
                            lastPage: readingPos.lastPage,
                            zoom: readingPos.zoom,
                            pageCount: readingPos.pageCount,
                            annotationCount: annotations.length + cropAnnotations.length,
                        };
                        promises.push(DocumentCatalogStorage.updateDocument(docId, meta));
                        useLibraryStore.getState().updateDocumentInStore(docId, meta);
                    }

                    await Promise.all(promises);

                    if (filePath) {
                        await PdfService.burnAndSave(filePath, burnableAnnotations);
                    }

                    set((state) => {
                        state.savedAnnotations = annotations;
                        state.savedBookmarks = bookmarks;
                        state.savedCrops = cropAnnotations;
                    });

                    useDocumentStore.getState().clearDirty();
                    toast.success("Saved");
                    return true;
                } catch (err: any) {
                    console.error("Failed to save PDF", err);
                    toast.error(err?.message || "Failed to save PDF");
                    return false;
                }
            },

            clear: () => {
                set((state) => {
                    state.docId = null;
                    state.annotations = [];
                    state.cropAnnotations = [];
                    state.bookmarks = [];
                    state.savedAnnotations = [];
                    state.savedBookmarks = [];
                    state.savedCrops = [];
                    state.hasEditedAnnotations = false;
                    state.seededDocId = null;
                    state.editingNoteId = null;
                    state.noteAnchorPos = null;
                });
                useAnnotationStore.temporal.getState().clear();
                useDocumentStore.getState().clearDirty();
            },
        })),
        {
            limit: 50,
            partialize: (state) => ({ annotations: state.annotations }),
            equality: (past, curr) => past.annotations === curr.annotations,
        },
    ),
);

useAnnotationStore.subscribe((state, prev) => {
    const changed =
        state.annotations !== prev.annotations ||
        state.savedAnnotations !== prev.savedAnnotations ||
        state.bookmarks !== prev.bookmarks ||
        state.savedBookmarks !== prev.savedBookmarks ||
        state.cropAnnotations !== prev.cropAnnotations ||
        state.savedCrops !== prev.savedCrops;

    if (!changed) return;

    const dirtySources: DirtySources = {
        annotations: !sameAnnotations(state.annotations, state.savedAnnotations),
        bookmarks: !sameBookmarks(state.bookmarks, state.savedBookmarks),
        crops: !sameCrops(state.cropAnnotations, state.savedCrops),
    };
    const isDirty =
        dirtySources.annotations || dirtySources.bookmarks || dirtySources.crops;
    const noteRemoved =
        Boolean(state.editingNoteId) &&
        !state.annotations.some((a) => a.id === state.editingNoteId);

    if (
        state.dirtySources.annotations !== dirtySources.annotations ||
        state.dirtySources.bookmarks !== dirtySources.bookmarks ||
        state.dirtySources.crops !== dirtySources.crops ||
        state.isDirty !== isDirty ||
        noteRemoved
    ) {
        useAnnotationStore.setState({
            dirtySources,
            isDirty,
            ...(noteRemoved ? { editingNoteId: null, noteAnchorPos: null } : {}),
        });
    }

    const docStore = useDocumentStore.getState();
    docStore.setDirtySource("annotations", dirtySources.annotations);
    docStore.setDirtySource("bookmarks", dirtySources.bookmarks);
    docStore.setDirtySource("crops", dirtySources.crops);
});

/** Hook to consume temporal (undo/redo) state reactively */
export const useAnnotationTemporal = <T>(
    selector: (state: TemporalState<{ annotations: PdfAnnotation[] }>) => T,
): T => useStore(useAnnotationStore.temporal, selector);