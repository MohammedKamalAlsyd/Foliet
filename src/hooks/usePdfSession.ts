import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PdfService } from "@/services/pdf";
import { DocumentCatalogStorage } from "@/services/storage/catalog";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useSummaryStore } from "@/stores/summaryStore";
import type { DocumentItem, PdfOutlineNode } from "@/types/document";

export interface UsePdfSessionOptions {
    activeDoc: DocumentItem | null;
    currentPage: number;
    zoomLevel: number;
    jumpToPage: (page: number) => void;
    isRestoringPageRef: React.MutableRefObject<boolean>;
}

export function usePdfSession({
    activeDoc,
    currentPage,
    zoomLevel,
    jumpToPage,
    isRestoringPageRef,
}: UsePdfSessionOptions) {
    const setDocPageCount = useDocumentStore((s) => s.setDocPageCount);

    const [pdfProxy, setPdfProxy] = useState<any | null>(null);
    const [totalPages, setTotalPages] = useState<number>(() =>
        Math.max(1, activeDoc?.pages || 1),
    );
    const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
    const [pageLabels, setPageLabels] = useState<string[]>([]);

    const pendingRestorePageRef = useRef<number | null>(
        activeDoc?.lastPage && activeDoc.lastPage > 1 ? activeDoc.lastPage : null,
    );

    // Document switch / initial load
    useEffect(() => {
        if (!activeDoc?.id) return;
        const docId = activeDoc.id;
        const initialPage = Math.max(1, activeDoc.lastPage || 1);
        const initialPages = Math.max(1, activeDoc.pages || 1);

        setPdfProxy(null);
        useSummaryStore.getState().setPdfProxy(null);
        useSummaryStore.getState().setChapters([]);
        setOutline([]);
        setPageLabels([]);
        setTotalPages(initialPages);

        pendingRestorePageRef.current = initialPage > 1 ? initialPage : null;
        if (pendingRestorePageRef.current) {
            isRestoringPageRef.current = true;
        }

        void useAnnotationStore
            .getState()
            .loadForDocument(docId, activeDoc.extractedAnnotations);
    }, [activeDoc?.id, activeDoc?.extractedAnnotations, isRestoringPageRef]);

    // Track latest reading state for debounced & unmount flush
    const annotationCount = useAnnotationStore(
        (s) => s.annotations.length + s.cropAnnotations.length,
    );

    const readingStateRef = useRef({
        docId: "",
        lastPage: 1,
        zoom: 100,
        pageCount: 1,
        annotationCount: 0,
        ready: false,
    });

    readingStateRef.current = {
        docId: activeDoc?.id ?? "",
        lastPage: currentPage,
        zoom: zoomLevel,
        pageCount: totalPages,
        annotationCount,
        ready: Boolean(pdfProxy) && !isRestoringPageRef.current,
    };

    const flushReadingPosition = useCallback(() => {
        const s = readingStateRef.current;
        if (s.docId && s.ready) {
            DocumentCatalogStorage.updateDocument(s.docId, {
                lastPage: s.lastPage,
                zoom: s.zoom,
                pageCount: s.pageCount,
                annotationCount: s.annotationCount,
            }).catch(() => {});
            useLibraryStore.getState().updateDocumentInStore(s.docId, {
                lastPage: s.lastPage,
                zoom: s.zoom,
                pageCount: s.pageCount,
                annotationCount: s.annotationCount,
            });
        }
    }, []);

    // Debounced reading position save (600ms)
    useEffect(() => {
        if (!activeDoc?.id || !pdfProxy || isRestoringPageRef.current) return;
        const timer = setTimeout(flushReadingPosition, 600);
        return () => clearTimeout(timer);
    }, [
        activeDoc?.id,
        pdfProxy,
        currentPage,
        zoomLevel,
        totalPages,
        annotationCount,
        flushReadingPosition,
        isRestoringPageRef,
    ]);

    // Flush immediately on unload / switch
    useEffect(() => {
        const onPageHide = () => flushReadingPosition();
        window.addEventListener("pagehide", onPageHide);
        return () => {
            window.removeEventListener("pagehide", onPageHide);
            flushReadingPosition();
        };
    }, [flushReadingPosition]);

    const handleDocumentLoadSuccess = useCallback(
        async (loaded: any) => {
            const count = loaded.numPages;
            setPdfProxy(loaded);
            useSummaryStore.getState().setPdfProxy(loaded);
            setTotalPages(count);
            if (activeDoc?.id) setDocPageCount(activeDoc.id, count);

            const targetPage = Math.min(
                count,
                Math.max(1, pendingRestorePageRef.current ?? 1),
            );

            if (targetPage > 1) {
                isRestoringPageRef.current = true;
                jumpToPage(targetPage);
                setTimeout(() => {
                    isRestoringPageRef.current = false;
                    pendingRestorePageRef.current = null;
                }, 120);
            } else {
                isRestoringPageRef.current = false;
                pendingRestorePageRef.current = null;
            }

            const [nextOutline, nextLabels] = await Promise.all([
                PdfService.extractOutline(loaded).catch(() => []),
                PdfService.extractPageLabels(loaded).catch(() => null),
            ]);
            setOutline(nextOutline);
            useSummaryStore
                .getState()
                .setChapters(PdfService.buildChapters(nextOutline, count));
            if (nextLabels) setPageLabels(nextLabels);
        },
        [activeDoc?.id, setDocPageCount, jumpToPage, isRestoringPageRef],
    );

    const handleDocumentLoadError = useCallback((err: Error) => {
        toast.error(err?.message || "Failed to load PDF");
    }, []);

    return {
        pdfProxy,
        totalPages,
        outline,
        pageLabels,
        flushReadingPosition,
        handleDocumentLoadSuccess,
        handleDocumentLoadError,
    };
}
