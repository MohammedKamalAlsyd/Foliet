import { useCallback, useEffect, useRef, useState } from "react";
import type {
    CropDragRect,
    QuickInsertCropState,
} from "@/components/viewer/layers/CropAndNoteLayer";
import type {
    CropAnnotation,
    NoteAnnotation,
    PdfAnnotation,
    Point,
} from "@/types/annotations";
import type { ToolType, UnderlineStyle } from "@/types/tools";
import { extractCaptionNearCropRect } from "@/utils/pdfDom";
import { mergeLineRects } from "@/utils/pdfGeometry";

const makeId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export interface PageSelectionState {
    text: string;
    rect: DOMRect;
    range: Range;
}

interface UsePagePointerToolsOptions {
    pageNumber: number;
    activeTool: ToolType;
    activeColor: string;
    activeStrokeWidth: number;
    activeUnderlineStyle: UnderlineStyle;
    isSummaryWorkspaceOpen: boolean;
    wrapperRef: React.RefObject<HTMLDivElement | null>;
    bufferCanvasRef: React.RefObject<HTMLCanvasElement | null>;
    onAddAnnotation: (annot: PdfAnnotation) => void;
    onNoteClick: (note: NoteAnnotation, anchor: { x: number; y: number }) => void;
    onAddFigureCrop: (crop: {
        pageNumber: number;
        imageUrl: string;
        x: number;
        y: number;
        width: number;
        height: number;
        caption?: string;
    }) => Promise<CropAnnotation | void> | CropAnnotation | void;
}

export function usePagePointerTools({
    pageNumber,
    activeTool,
    activeColor,
    activeStrokeWidth,
    activeUnderlineStyle,
    isSummaryWorkspaceOpen,
    wrapperRef,
    bufferCanvasRef,
    onAddAnnotation,
    onNoteClick,
    onAddFigureCrop,
}: UsePagePointerToolsOptions) {
    const quickInsertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const [inkDraft, setInkDraft] = useState<Point[] | null>(null);
    const [cropRect, setCropRect] = useState<CropDragRect | null>(null);
    const [quickInsertCrop, setQuickInsertCrop] =
        useState<QuickInsertCropState | null>(null);
    const [selectionState, setSelectionState] =
        useState<PageSelectionState | null>(null);

    const isTextTool =
        activeTool === "select" ||
        activeTool === "highlight" ||
        activeTool === "underline" ||
        activeTool === "strikethrough";

    useEffect(() => {
        if (activeTool !== "select" && selectionState) {
            setSelectionState(null);
        }
        if (!isTextTool && typeof window !== "undefined") {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) {
                sel.removeAllRanges();
            }
        }
    }, [activeTool, isTextTool, selectionState]);

    useEffect(() => {
        return () => {
            if (quickInsertTimerRef.current) {
                clearTimeout(quickInsertTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!selectionState) return;
        const handleDocSelectionChange = () => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !sel.toString().trim()) {
                setSelectionState(null);
            }
        };
        document.addEventListener("selectionchange", handleDocSelectionChange);
        return () => {
            document.removeEventListener("selectionchange", handleDocSelectionChange);
        };
    }, [selectionState]);

    const normalizePoint = useCallback(
        (clientX: number, clientY: number): Point | null => {
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return null;
            return {
                x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
                y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
            };
        },
        [wrapperRef],
    );

    const handleTextMarkup = useCallback(() => {
        if (
            activeTool !== "highlight" &&
            activeTool !== "underline" &&
            activeTool !== "strikethrough"
        ) {
            return;
        }

        const selection = window.getSelection();
        const wrapper = wrapperRef.current;
        if (!selection || selection.isCollapsed || !wrapper) return;

        const text = selection.toString().trim();
        if (!text) return;

        const pageRect = wrapper.getBoundingClientRect();
        if (pageRect.width <= 0 || pageRect.height <= 0) return;

        const range = selection.getRangeAt(0);
        if (!wrapper.contains(range.commonAncestorContainer)) return;

        const rectSegments = mergeLineRects(
            Array.from(range.getClientRects())
                .map((r) => ({
                    x: Math.max(0, (r.left - pageRect.left) / pageRect.width),
                    y: Math.max(0, (r.top - pageRect.top) / pageRect.height),
                    width: Math.min(1, r.width / pageRect.width),
                    height: Math.min(1, r.height / pageRect.height),
                }))
                .filter((r) => r.width > 0.002 && r.height > 0.002),
        );

        selection.removeAllRanges();
        if (rectSegments.length === 0) return;

        onAddAnnotation({
            id: makeId("markup"),
            pageNumber,
            toolType: activeTool,
            color: activeColor,
            text,
            rectSegments,
            underlineStyle:
                activeTool === "underline" ? activeUnderlineStyle : undefined,
            x: rectSegments[0].x,
            y: rectSegments[0].y,
            createdAt: new Date().toISOString(),
        });
    }, [
        activeTool,
        activeColor,
        activeUnderlineStyle,
        pageNumber,
        wrapperRef,
        onAddAnnotation,
    ]);

    const handleMouseUp = useCallback(() => {
        if (activeTool === "select") {
            const selection = window.getSelection();
            const wrapper = wrapperRef.current;
            if (!selection || selection.isCollapsed || !wrapper) {
                setSelectionState(null);
                return;
            }

            const text = selection.toString().trim();
            if (!text || selection.rangeCount === 0) {
                setSelectionState(null);
                return;
            }

            const range = selection.getRangeAt(0);
            if (
                !wrapper.contains(range.commonAncestorContainer) &&
                !wrapper.contains(range.startContainer)
            ) {
                return;
            }

            const rect = range.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                setSelectionState({ text, rect, range: range.cloneRange() });
            }
            return;
        }

        if (
            activeTool === "highlight" ||
            activeTool === "underline" ||
            activeTool === "strikethrough"
        ) {
            handleTextMarkup();
        }
    }, [activeTool, wrapperRef, handleTextMarkup]);

    const handleOverlayPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            const pt = normalizePoint(e.clientX, e.clientY);
            if (!pt) return;

            if (activeTool === "popup_note") {
                const note: NoteAnnotation = {
                    id: makeId("note"),
                    pageNumber,
                    toolType: "popup_note",
                    color: activeColor,
                    comment: "",
                    x: pt.x,
                    y: pt.y,
                    createdAt: new Date().toISOString(),
                };
                onAddAnnotation(note);
                onNoteClick(note, { x: e.clientX, y: e.clientY });
                return;
            }

            if (activeTool === "freehand_write") {
                e.currentTarget.setPointerCapture(e.pointerId);
                setInkDraft([pt]);
            } else if (activeTool === "area_select") {
                e.currentTarget.setPointerCapture(e.pointerId);
                setCropRect({
                    startX: pt.x,
                    startY: pt.y,
                    currX: pt.x,
                    currY: pt.y,
                });
            }
        },
        [activeTool, activeColor, pageNumber, normalizePoint, onAddAnnotation, onNoteClick],
    );

    const handleOverlayPointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const pt = normalizePoint(e.clientX, e.clientY);
            if (!pt) return;

            if (inkDraft) {
                setInkDraft((prev) => {
                    if (!prev) return null;
                    const last = prev[prev.length - 1];
                    if (
                        last &&
                        Math.abs(pt.x - last.x) < 0.0012 &&
                        Math.abs(pt.y - last.y) < 0.0012
                    ) {
                        return prev;
                    }
                    return [...prev, pt];
                });
            } else if (cropRect) {
                setCropRect((prev) =>
                    prev ? { ...prev, currX: pt.x, currY: pt.y } : null,
                );
            }
        },
        [inkDraft, cropRect, normalizePoint],
    );

    const handleOverlayPointerUp = useCallback(async () => {
        if (inkDraft) {
            if (inkDraft.length >= 2) {
                onAddAnnotation({
                    id: makeId("ink"),
                    pageNumber,
                    toolType: "freehand_write",
                    color: activeColor,
                    strokeWidth: activeStrokeWidth,
                    points: inkDraft,
                    x: inkDraft[0].x,
                    y: inkDraft[0].y,
                    createdAt: new Date().toISOString(),
                });
            }
            setInkDraft(null);
        }

        if (cropRect) {
            const x = Math.min(cropRect.startX, cropRect.currX);
            const y = Math.min(cropRect.startY, cropRect.currY);
            const width = Math.abs(cropRect.currX - cropRect.startX);
            const height = Math.abs(cropRect.currY - cropRect.startY);
            setCropRect(null);

            const wrapper = wrapperRef.current;
            if (width > 0.02 && height > 0.02 && wrapper) {
                const canvas = (wrapper.querySelector(".react-pdf__Page__canvas") ??
                    bufferCanvasRef.current) as HTMLCanvasElement | null;
                if (canvas && canvas.width > 0 && canvas.height > 0) {
                    const out = document.createElement("canvas");
                    const sx = x * canvas.width;
                    const sy = y * canvas.height;
                    const sw = Math.max(1, width * canvas.width);
                    const sh = Math.max(1, height * canvas.height);
                    out.width = sw;
                    out.height = sh;
                    const ctx = out.getContext("2d");
                    if (ctx) {
                        ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
                        const caption = extractCaptionNearCropRect(wrapper, {
                            x,
                            y,
                            width,
                            height,
                        });
                        const savedCrop = await onAddFigureCrop({
                            pageNumber,
                            imageUrl: out.toDataURL("image/png"),
                            x,
                            y,
                            width,
                            height,
                            caption,
                        });
                        if (savedCrop && isSummaryWorkspaceOpen) {
                            if (quickInsertTimerRef.current) {
                                clearTimeout(quickInsertTimerRef.current);
                            }
                            setQuickInsertCrop({
                                crop: savedCrop,
                                x: Math.min(0.85, x + width / 2),
                                y: Math.min(0.92, y + height),
                            });
                            quickInsertTimerRef.current = setTimeout(() => {
                                setQuickInsertCrop(null);
                            }, 6000);
                        }
                    }
                }
            }
        }
    }, [
        inkDraft,
        cropRect,
        pageNumber,
        activeColor,
        activeStrokeWidth,
        isSummaryWorkspaceOpen,
        wrapperRef,
        bufferCanvasRef,
        onAddAnnotation,
        onAddFigureCrop,
    ]);

    const handleOverlayPointerCancel = useCallback(() => {
        setInkDraft(null);
        setCropRect(null);
    }, []);

    const dismissQuickInsert = useCallback(() => setQuickInsertCrop(null), []);
    const clearSelectionState = useCallback(() => setSelectionState(null), []);

    return {
        inkDraft,
        cropRect,
        quickInsertCrop,
        selectionState,
        dismissQuickInsert,
        clearSelectionState,
        handleMouseUp,
        handleOverlayPointerDown,
        handleOverlayPointerMove,
        handleOverlayPointerUp,
        handleOverlayPointerCancel,
    };
}