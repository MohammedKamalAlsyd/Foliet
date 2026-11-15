import { useCallback, useEffect, useRef, useState } from "react";
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

export function useLibraryCatalog(activeCollection: string | null) {
    const openDocument = useDocumentStore((s) => s.openDocument);
    const setExtractedAnnotations = useDocumentStore(
        (s) => s.setExtractedAnnotations,
    );

    const [documents, setDocuments] = useState<CatalogItem[]>([]);
    const [collections, setCollections] = useState<string[]>([]);
    const [isClearing, setIsClearing] = useState(false);

    const docsRef = useRef<CatalogItem[]>([]);
    const colsRef = useRef<string[]>([]);
    docsRef.current = documents;
    colsRef.current = collections;

    useEffect(() => {
        let active = true;
        Promise.all([
            DocumentCatalogStorage.getDocuments(),
            DocumentCatalogStorage.getCollections(),
        ])
            .then(([loadedDocs, loadedCols]) => {
                if (!active) return;
                const cleanDocs = deduplicateDocuments(loadedDocs);
                const docCols = cleanDocs
                    .map((d) => d.collection)
                    .filter((c): c is string => Boolean(c));
                setDocuments(cleanDocs);
                setCollections(normalizeCollections([...loadedCols, ...docCols]));
            })
            .catch(() => toast.error("Failed to load library catalog"));

        return () => {
            active = false;
        };
    }, []);

    const openPdfPath = useCallback(
        async (filePath: string, existingDoc?: CatalogItem) => {
            try {
                const result = await PdfService.openDocument(filePath);
                const existing =
                    existingDoc ??
                    docsRef.current.find(
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
                    ...stripByIdentity(docsRef.current, result.docId, result.filePath),
                ];
                setDocuments(nextDocs);
                DocumentCatalogStorage.saveDocuments(nextDocs).catch(() => { });

                openDocument({
                    id: result.docId,
                    title,
                    pages: catalogEntry.pageCount,
                    filePath: result.filePath,
                    lastPage: catalogEntry.lastPage,
                    scrollOffset: catalogEntry.scrollOffset,
                    zoom: catalogEntry.zoom,
                    extractedAnnotations: result.extractedAnnotations,
                });

                // Skip heavy Rust annotation extraction if SQLite already has annotations,
                // and defer slightly so pdf.js renders page 1 uncontended.
                if (!result.extractedAnnotations) {
                    DocumentDatabase.getAnnotations(result.docId)
                        .then((saved) => {
                            if (saved.length > 0) return;
                            setTimeout(() => {
                                PdfService.extractAnnotations(result.filePath)
                                    .then((annots) => {
                                        if (annots?.length) {
                                            setExtractedAnnotations(result.docId, annots);
                                        }
                                    })
                                    .catch(() => { });
                            }, 400);
                        })
                        .catch(() => { });
                }
            } catch (err: any) {
                toast.error(err?.message || "Failed to open PDF");
            }
        },
        [activeCollection, openDocument, setExtractedAnnotations],
    );

    const openCatalogDoc = useCallback(
        (doc: CatalogItem) => {
            if (!doc.filePath) {
                toast.error(`Missing file path for "${doc.title}"`);
                return;
            }
            openPdfPath(doc.filePath, doc);
        },
        [openPdfPath],
    );

    const importPdf = useCallback(async () => {
        try {
            const result = await PdfService.pickFile();
            if (result) await openPdfPath(result.filePath);
        } catch (err: any) {
            toast.error(err?.message || "Could not open file");
        }
    }, [openPdfPath]);

    const forgetDoc = useCallback(async (docId: string) => {
        try {
            const annots = await DocumentDatabase.getAnnotations(docId);
            await Promise.all(
                annots
                    .filter((a) => a.toolType === "area_select")
                    .map((a) => DocumentDatabase.deleteFigureCrop(a.id)),
            );
            await DocumentCatalogStorage.removeDocument(docId);
            setDocuments((prev) => prev.filter((d) => d.id !== docId));
        } catch {
            toast.error("Failed to remove document records");
        }
    }, []);

    const clearAll = useCallback(async () => {
        setIsClearing(true);
        try {
            await DocumentCatalogStorage.clearAll();
            setDocuments([]);
            setCollections([]);
            return true;
        } catch {
            toast.error("Failed to clear library");
            return false;
        } finally {
            setIsClearing(false);
        }
    }, []);

    const createCollection = useCallback(async (rawName: string) => {
        const clean = rawName.trim();
        if (!clean) return null;

        const duplicate = colsRef.current.find(
            (c) => c.toLowerCase() === clean.toLowerCase(),
        );
        if (duplicate) {
            toast.error(`Collection "${duplicate}" already exists`);
            return null;
        }

        const next = normalizeCollections([...colsRef.current, clean]);
        setCollections(next);
        await DocumentCatalogStorage.saveCollections(next);
        return clean;
    }, []);

    const renameCollection = useCallback(
        async (oldName: string, rawNewName: string) => {
            const clean = rawNewName.trim();
            if (!clean || clean === oldName) return oldName;

            const conflict = colsRef.current.find(
                (c) => c !== oldName && c.toLowerCase() === clean.toLowerCase(),
            );
            if (conflict) {
                toast.error(`Collection "${conflict}" already exists`);
                return null;
            }

            const nextCols = normalizeCollections(
                colsRef.current.map((c) => (c === oldName ? clean : c)),
            );
            const nextDocs = docsRef.current.map((d) =>
                d.collection === oldName ? { ...d, collection: clean } : d,
            );

            setCollections(nextCols);
            setDocuments(nextDocs);
            await Promise.all([
                DocumentCatalogStorage.saveCollections(nextCols),
                DocumentCatalogStorage.saveDocuments(nextDocs),
            ]);
            return clean;
        },
        [],
    );

    const deleteCollection = useCallback(async (name: string) => {
        const nextCols = colsRef.current.filter((c) => c !== name);
        const nextDocs = docsRef.current.map((d) =>
            d.collection === name ? { ...d, collection: undefined } : d,
        );

        setCollections(nextCols);
        setDocuments(nextDocs);
        await Promise.all([
            DocumentCatalogStorage.saveCollections(nextCols),
            DocumentCatalogStorage.saveDocuments(nextDocs),
        ]);
    }, []);

    const setDocCollection = useCallback(
        async (docId: string, collection?: string) => {
            const nextDocs = docsRef.current.map((d) =>
                d.id === docId ? { ...d, collection } : d,
            );
            setDocuments(nextDocs);
            await DocumentCatalogStorage.saveDocuments(nextDocs);
        },
        [],
    );

    return {
        documents,
        collections,
        isClearing,
        openPdfPath,
        openCatalogDoc,
        importPdf,
        forgetDoc,
        clearAll,
        createCollection,
        renameCollection,
        deleteCollection,
        setDocCollection,
    };
}