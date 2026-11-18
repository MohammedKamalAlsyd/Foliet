import { create } from "zustand";
import { toast } from "sonner";
import { PdfService } from "@/services/pdf";
import {
    DocumentCatalogStorage,
    deduplicateDocuments,
    normalizeCollections,
    normalizePath,
} from "@/services/storage/catalog";
import { DocumentDatabase } from "@/services/storage/database";
import { useDocumentStore } from "@/stores/documentStore";
import type { CatalogItem } from "@/types/catalog";

const stripByIdentity = (
    list: CatalogItem[],
    id: string,
    filePath?: string,
) => {
    const norm = normalizePath(filePath);
    return list.filter(
        (d) => d.id !== id && (!norm || normalizePath(d.filePath) !== norm),
    );
};

export interface LibraryState {
    documents: CatalogItem[];
    collections: string[];
    isClearing: boolean;

    loadCatalog: () => Promise<void>;
    openPdfPath: (
        filePath: string,
        existingDoc?: CatalogItem,
        activeCollection?: string | null,
    ) => Promise<void>;
    openCatalogDoc: (doc: CatalogItem) => void;
    importPdf: (activeCollection?: string | null) => Promise<void>;
    forgetDoc: (docId: string) => Promise<void>;
    clearAll: () => Promise<boolean>;
    createCollection: (rawName: string) => Promise<string | null>;
    renameCollection: (oldName: string, rawNewName: string) => Promise<string | null>;
    deleteCollection: (name: string) => Promise<void>;
    setDocCollection: (docId: string, collection?: string) => Promise<void>;
    updateDocumentInStore: (docId: string, patch: Partial<CatalogItem>) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
    documents: [],
    collections: [],
    isClearing: false,

    loadCatalog: async () => {
        try {
            const [loadedDocs, loadedCols] = await Promise.all([
                DocumentCatalogStorage.getDocuments(),
                DocumentCatalogStorage.getCollections(),
            ]);
            const cleanDocs = deduplicateDocuments(loadedDocs);
            const docCols = cleanDocs
                .map((d) => d.collection)
                .filter((c): c is string => Boolean(c));
            set({
                documents: cleanDocs,
                collections: normalizeCollections([...loadedCols, ...docCols]),
            });
        } catch {
            toast.error("Failed to load library catalog");
        }
    },

    openPdfPath: async (filePath, existingDoc, activeCollection) => {
        try {
            const result = await PdfService.openDocument(filePath);
            const docs = get().documents;
            const existing =
                existingDoc ??
                docs.find(
                    (d) =>
                        d.id === result.docId ||
                        normalizePath(d.filePath) === normalizePath(result.filePath),
                );

            const now = Date.now();
            const title =
                existing?.title ||
                result.fileName.replace(/\.pdf$/i, "") ||
                "Untitled document";

            const catalogEntry: CatalogItem = {
                id: result.docId,
                title,
                fileName: result.fileName,
                filePath: result.filePath,
                fileSize: result.fileSize,
                pageCount: existing?.pageCount || result.numPages,
                lastPage: existing?.lastPage ?? 1,
                scrollOffset: existing?.scrollOffset ?? 0,
                zoom: existing?.zoom ?? 100,
                authors: existing?.authors,
                year: existing?.year,
                collection: existing?.collection ?? activeCollection ?? undefined,
                addedAt: existing?.addedAt ?? now,
                lastOpenedAt: now,
                isIndexed: existing?.isIndexed,
                annotationCount: existing?.annotationCount,
            };

            const nextDocs = [
                catalogEntry,
                ...stripByIdentity(docs, result.docId, result.filePath),
            ];
            set({ documents: nextDocs });
            DocumentCatalogStorage.saveDocuments(nextDocs).catch(() => {});

            useDocumentStore.getState().openDocument({
                id: result.docId,
                title,
                pages: catalogEntry.pageCount,
                filePath: result.filePath,
                lastPage: catalogEntry.lastPage,
                scrollOffset: catalogEntry.scrollOffset,
                zoom: catalogEntry.zoom,
                extractedAnnotations: result.extractedAnnotations,
            });

            if (!result.extractedAnnotations) {
                DocumentDatabase.getAnnotations(result.docId)
                    .then((saved) => {
                        if (saved.length > 0) return;
                        setTimeout(() => {
                            PdfService.extractAnnotations(result.filePath)
                                .then((annots) => {
                                    if (annots?.length) {
                                        useDocumentStore
                                            .getState()
                                            .setExtractedAnnotations(result.docId, annots);
                                    }
                                })
                                .catch(() => {});
                        }, 400);
                    })
                    .catch(() => {});
            }
        } catch (err: any) {
            toast.error(err?.message || "Failed to open PDF");
        }
    },

    openCatalogDoc: (doc) => {
        if (!doc.filePath) {
            toast.error(`Missing file path for "${doc.title}"`);
            return;
        }
        get().openPdfPath(doc.filePath, doc);
    },

    importPdf: async (activeCollection) => {
        try {
            const result = await PdfService.pickFile();
            if (result) await get().openPdfPath(result.filePath, undefined, activeCollection);
        } catch (err: any) {
            toast.error(err?.message || "Could not open file");
        }
    },

    forgetDoc: async (docId) => {
        try {
            const annots = await DocumentDatabase.getAnnotations(docId);
            await Promise.all(
                annots
                    .filter((a) => a.toolType === "area_select")
                    .map((a) => DocumentDatabase.deleteFigureCrop(a.id)),
            );
            await DocumentCatalogStorage.removeDocument(docId);
            set((state) => ({ documents: state.documents.filter((d) => d.id !== docId) }));
        } catch {
            toast.error("Failed to remove document records");
        }
    },

    clearAll: async () => {
        set({ isClearing: true });
        try {
            await DocumentCatalogStorage.clearAll();
            set({ documents: [], collections: [] });
            return true;
        } catch {
            toast.error("Failed to clear library");
            return false;
        } finally {
            set({ isClearing: false });
        }
    },

    createCollection: async (rawName) => {
        const clean = rawName.trim();
        if (!clean) return null;

        const cols = get().collections;
        const duplicate = cols.find((c) => c.toLowerCase() === clean.toLowerCase());
        if (duplicate) {
            toast.error(`Collection "${duplicate}" already exists`);
            return null;
        }

        const next = normalizeCollections([...cols, clean]);
        set({ collections: next });
        await DocumentCatalogStorage.saveCollections(next);
        return clean;
    },

    renameCollection: async (oldName, rawNewName) => {
        const clean = rawNewName.trim();
        if (!clean || clean === oldName) return oldName;

        const cols = get().collections;
        const conflict = cols.find(
            (c) => c !== oldName && c.toLowerCase() === clean.toLowerCase(),
        );
        if (conflict) {
            toast.error(`Collection "${conflict}" already exists`);
            return null;
        }

        const nextCols = normalizeCollections(
            cols.map((c) => (c === oldName ? clean : c)),
        );
        const nextDocs = get().documents.map((d) =>
            d.collection === oldName ? { ...d, collection: clean } : d,
        );

        set({ collections: nextCols, documents: nextDocs });
        await Promise.all([
            DocumentCatalogStorage.saveCollections(nextCols),
            DocumentCatalogStorage.saveDocuments(nextDocs),
        ]);
        return clean;
    },

    deleteCollection: async (name) => {
        const nextCols = get().collections.filter((c) => c !== name);
        const nextDocs = get().documents.map((d) =>
            d.collection === name ? { ...d, collection: undefined } : d,
        );

        set({ collections: nextCols, documents: nextDocs });
        await Promise.all([
            DocumentCatalogStorage.saveCollections(nextCols),
            DocumentCatalogStorage.saveDocuments(nextDocs),
        ]);
    },

    setDocCollection: async (docId, collection) => {
        const nextDocs = get().documents.map((d) =>
            d.id === docId ? { ...d, collection } : d,
        );
        set({ documents: nextDocs });
        await DocumentCatalogStorage.saveDocuments(nextDocs);
    },

    updateDocumentInStore: (docId, patch) =>
        set((state) => ({
            documents: state.documents.map((doc) =>
                doc.id === docId ? { ...doc, ...patch, id: doc.id } : doc,
            ),
        })),
}));

// Load library catalog on startup
void useLibraryStore.getState().loadCatalog();
