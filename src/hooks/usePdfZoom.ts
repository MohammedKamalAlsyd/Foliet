import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import type { Dimensions } from "@/types/common";

const DEFAULT_DIM: Dimensions = { width: 612, height: 792 };

export interface UsePdfZoomOptions {
    initialZoom?: number;
    scrollRef: React.RefObject<HTMLDivElement | null>;
    pageDimensions: Record<number, Dimensions>;
    currentPage: number;
    pdfSource: string | null;
    pdfProxy: any;
    isRestoringPageRef: React.RefObject<boolean>;
}

export function usePdfZoom({
    initialZoom = 100,
    scrollRef,
    pageDimensions,
    currentPage,
    pdfSource,
    pdfProxy,
    isRestoringPageRef,
}: UsePdfZoomOptions) {
    const [zoomLevel, setZoomLevel] = useState<number>(initialZoom);
    const [renderZoom] = useDebounce(zoomLevel, 140);
    const [isCtrlHeld, setIsCtrlHeld] = useState(false);
    const prevZoomRef = useRef(initialZoom);

    // Keep viewport reading center anchored proportionally when zoom changes
    useLayoutEffect(() => {
        const prevZoom = prevZoomRef.current;
        prevZoomRef.current = zoomLevel;
        if (
            prevZoom === zoomLevel ||
            !scrollRef.current ||
            isRestoringPageRef.current
        ) {
            return;
        }
        const container = scrollRef.current;
        const ratio = zoomLevel / prevZoom;
        const centerY = container.scrollTop + container.clientHeight / 2;
        container.scrollTop = Math.max(
            0,
            centerY * ratio - container.clientHeight / 2,
        );
    }, [zoomLevel, scrollRef, isRestoringPageRef]);

    // Ctrl/Cmd + Wheel zoom
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                setZoomLevel((z) =>
                    Math.min(500, Math.max(25, z + (e.deltaY < 0 ? 10 : -10))),
                );
            }
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [pdfSource, pdfProxy, scrollRef]);

    // Ctrl held tracking for link overlay
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Control" || e.key === "Meta") setIsCtrlHeld(true);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === "Control" || e.key === "Meta") setIsCtrlHeld(false);
        };
        const onBlur = () => setIsCtrlHeld(false);

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, []);

    const resetZoom = useCallback(() => setZoomLevel(100), []);

    const handleFitToWidth = useCallback(() => {
        if (!scrollRef.current) return;
        const avail = scrollRef.current.clientWidth - 48;
        const dim = pageDimensions[currentPage] ?? pageDimensions[1] ?? DEFAULT_DIM;
        if (dim.width > 0) {
            setZoomLevel(
                Math.min(500, Math.max(25, Math.floor((avail / dim.width) * 100))),
            );
        }
    }, [pageDimensions, currentPage, scrollRef]);

    return {
        zoomLevel,
        renderZoom,
        isCtrlHeld,
        setZoomLevel,
        resetZoom,
        handleFitToWidth,
    };
}
