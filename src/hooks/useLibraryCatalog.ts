import { useCallback } from "react";
import { useLibraryStore } from "@/stores/libraryStore";
import type { CatalogItem } from "@/types/catalog";

export function useLibraryCatalog(activeCollection: string | null) {
    const documents = useLibraryStore((s) => s.documents);
    const collections = useLibraryStore((s) => s.collections);
    const isClearing = useLibraryStore((s) => s.isClearing);
    const openCatalogDoc = useLibraryStore((s) => s.openCatalogDoc);
    const forgetDoc = useLibraryStore((s) => s.forgetDoc);
    const clearAll = useLibraryStore((s) => s.clearAll);
    const createCollection = useLibraryStore((s) => s.createCollection);
    const renameCollection = useLibraryStore((s) => s.renameCollection);
    const deleteCollection = useLibraryStore((s) => s.deleteCollection);
    const setDocCollection = useLibraryStore((s) => s.setDocCollection);

    const openPdfPath = useCallback(
        (filePath: string, existingDoc?: CatalogItem) =>
            useLibraryStore.getState().openPdfPath(filePath, existingDoc, activeCollection),
        [activeCollection],
    );

    const importPdf = useCallback(
        () => useLibraryStore.getState().importPdf(activeCollection),
        [activeCollection],
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
