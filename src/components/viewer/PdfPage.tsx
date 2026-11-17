import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page } from "react-pdf";
import { MessageSquare, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectionActionBar } from "@/components/viewer/SelectionActionBar";
import { useRagStore } from "@/stores/ragStore";
import {
  type InkAnnotation,
  type NoteAnnotation,
  type PdfAnnotation,
  type Point,
  type TextMarkupAnnotation,
  isInkAnnotation,
  isNoteAnnotation,
  isTextMarkupAnnotation,
} from "@/types/annotations";
import type { ToolType, UnderlineStyle } from "@/types/tools";

interface PdfPageProps {
  pageNumber: number;
  zoomLevel: number;
  renderZoomLevel: number;
  estimatedWidth: number;
  estimatedHeight: number;
  activeTool: ToolType;
  activeColor: string;
  activeStrokeWidth: number;
  activeUnderlineStyle: UnderlineStyle;
  pageAnnotations: PdfAnnotation[];
  registerPageRef: (pageNumber: number, el: HTMLDivElement | null) => void;
  onAddAnnotation: (annot: PdfAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
  onNoteClick: (note: NoteAnnotation, anchor: { x: number; y: number }) => void;
  onAddFigureCrop: (crop: {
    pageNumber: number;
    imageUrl: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onDimensionsDiscovered: (page: number, width: number, height: number) => void;
}

const makeId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const pointsToSvgPath = (points: Point[]) =>
  points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * 1000} ${p.y * 1000}`)
    .join(" ");

type RectSegment = { x: number; y: number; width: number; height: number };

const mergeRectSegments = (rects: RectSegment[]): RectSegment[] => {
  if (rects.length <= 1) return rects;
  const sorted = [...rects].sort((a, b) =>
    Math.abs(a.y - b.y) > 0.004 ? a.y - b.y : a.x - b.x,
  );
  const merged: RectSegment[] = [];
  for (const r of sorted) {
    const target = merged.find((m) => {
      const overlapY =
        Math.min(m.y + m.height, r.y + r.height) - Math.max(m.y, r.y);
      const minH = Math.min(m.height, r.height);
      const sameLine = minH > 0 && overlapY / minH > 0.5;
      const horizontalTouch =
        r.x <= m.x + m.width + 0.008 && m.x <= r.x + r.width + 0.008;
      return sameLine && horizontalTouch;
    });
    if (target) {
      const minX = Math.min(target.x, r.x);
      const minY = Math.min(target.y, r.y);
      const maxX = Math.max(target.x + target.width, r.x + r.width);
      const maxY = Math.max(target.y + target.height, r.y + r.height);
      target.x = minX;
      target.y = minY;
      target.width = maxX - minX;
      target.height = maxY - minY;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
};

const svgCursor = (svg: string, x: number, y: number, fallback: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

function getToolCursor(tool: ToolType, color: string): string | undefined {
  switch (tool) {
    case "freehand_write":
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' fill='white' stroke='#18181b' stroke-width='1.6' stroke-linejoin='round'/><path d='m14 6 4 4' stroke='${color}' stroke-width='2.4'/></svg>`,
        2,
        21,
        "crosshair",
      );
    case "highlight":
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='m9 11-6 6v3h3l6-6' fill='${color}' fill-opacity='0.9' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/><path d='m20 7-5-5-8 8 5 5 8-8Z' fill='white' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/></svg>`,
        3,
        20,
        "text",
      );
    case "underline":
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M9 4h6M9 17h6M12 4v13' stroke='#18181b' stroke-width='1.7' stroke-linecap='round'/><path d='M5 20.5h14' stroke='${color}' stroke-width='2.6' stroke-linecap='round'/></svg>`,
        12,
        11,
        "text",
      );
    case "strikethrough":
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M9 4h6M9 20h6M12 4v16' stroke='#18181b' stroke-width='1.7' stroke-linecap='round'/><path d='M4 12h16' stroke='${color}' stroke-width='2.6' stroke-linecap='round'/></svg>`,
        12,
        12,
        "text",
      );
    case "popup_note":
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5Z' fill='${color}' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/><path d='M8 8h8M8 12h5' stroke='white' stroke-width='1.5' stroke-linecap='round'/></svg>`,
        4,
        20,
        "cell",
      );
    case "eraser":
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21H7Z' fill='white' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/><path d='m5.5 11.5 7 7' stroke='#dc2626' stroke-width='1.5'/><path d='M3 21h18' stroke='#18181b' stroke-width='1.5' stroke-linecap='round'/></svg>`,
        5,
        19,
        "pointer",
      );
    case "area_select":
      return svgCursor(
        `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M12 4v16M4 12h16' stroke='#18181b' stroke-width='1.6' stroke-linecap='round'/><circle cx='12' cy='12' r='2.2' fill='${color}' stroke='#18181b' stroke-width='1.2'/></svg>`,
        12,
        12,
        "crosshair",
      );
    default:
      return undefined;
  }
}

export const PdfPage = memo(function PdfPage({
  pageNumber,
  zoomLevel,
  renderZoomLevel,
  estimatedWidth,
  estimatedHeight,
  activeTool,
  activeColor,
  activeStrokeWidth,
  activeUnderlineStyle,
  pageAnnotations,
  registerPageRef,
  onAddAnnotation,
  onDeleteAnnotation,
  onNoteClick,
  onAddFigureCrop,
  onDimensionsDiscovered,
}: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [discoveredDim, setDiscoveredDim] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [inkDraft, setInkDraft] = useState<Point[] | null>(null);
  const [cropRect, setCropRect] = useState<{
    startX: number;
    startY: number;
    currX: number;
    currY: number;
  } | null>(null);
  const [selectionState, setSelectionState] = useState<{
    text: string;
    rect: DOMRect;
  } | null>(null);

  const activeRagHighlight = useRagStore((s) => s.activeRagHighlight);
  const isRagHighlighted = Boolean(
    activeRagHighlight && activeRagHighlight.pageNumber === pageNumber,
  );

  // Clear selection action bar if tool changes away from select
  useEffect(() => {
    if (activeTool !== "select" && selectionState) {
      setSelectionState(null);
    }
  }, [activeTool, selectionState]);

  // Dismiss action bar when selection is cleared in document
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

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      wrapperRef.current = el;
      registerPageRef(pageNumber, el);
    },
    [pageNumber, registerPageRef],
  );

  const { textMarkups, inkAnnotations, noteAnnotations } = useMemo(() => {
    const textMarkups: TextMarkupAnnotation[] = [];
    const inkAnnotations: InkAnnotation[] = [];
    const noteAnnotations: NoteAnnotation[] = [];
    for (const a of pageAnnotations) {
      if (isTextMarkupAnnotation(a)) textMarkups.push(a);
      else if (isInkAnnotation(a)) inkAnnotations.push(a);
      else if (isNoteAnnotation(a)) noteAnnotations.push(a);
    }
    return { textMarkups, inkAnnotations, noteAnnotations };
  }, [pageAnnotations]);

  const toolCursor = useMemo(
    () => getToolCursor(activeTool, activeColor),
    [activeTool, activeColor],
  );

  const normalizePoint = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
      };
    },
    [],
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

    const rectSegments = mergeRectSegments(
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
        setSelectionState({ text, rect });
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
  }, [activeTool, handleTextMarkup]);

  const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
      setCropRect({ startX: pt.x, startY: pt.y, currX: pt.x, currY: pt.y });
    }
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = normalizePoint(e.clientX, e.clientY);
    if (!pt) return;

    if (inkDraft) {
      setInkDraft((prev) => {
        if (!prev) return null;
        const last = prev[prev.length - 1];
        if (
          last &&
          Math.abs(pt.x - last.x) < 0.0015 &&
          Math.abs(pt.y - last.y) < 0.0015
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
  };

  const handleOverlayPointerUp = () => {
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

      if (width > 0.02 && height > 0.02 && wrapperRef.current) {
        const canvas = (wrapperRef.current.querySelector(
          ".react-pdf__Page__canvas",
        ) ?? bufferCanvasRef.current) as HTMLCanvasElement | null;
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
            onAddFigureCrop({
              pageNumber,
              imageUrl: out.toDataURL("image/png"),
              x,
              y,
              width,
              height,
            });
          }
        }
      }
    }
  };

  const handlePageLoadSuccess = useCallback(
    (page: any) => {
      const vp = page.getViewport({ scale: 1 });
      setDiscoveredDim({ width: vp.width, height: vp.height });
      onDimensionsDiscovered(pageNumber, vp.width, vp.height);
    },
    [pageNumber, onDimensionsDiscovered],
  );

  // Snapshot rendered canvas into back-buffer so subsequent zoom re-renders never blink white
  const handlePageRenderSuccess = useCallback(() => {
    const wrapper = wrapperRef.current;
    const buf = bufferCanvasRef.current;
    if (!wrapper || !buf) return;
    const pdfCanvas = wrapper.querySelector(
      ".react-pdf__Page__canvas",
    ) as HTMLCanvasElement | null;
    if (!pdfCanvas || pdfCanvas.width === 0 || pdfCanvas.height === 0) return;

    buf.width = pdfCanvas.width;
    buf.height = pdfCanvas.height;
    const ctx = buf.getContext("2d");
    ctx?.drawImage(pdfCanvas, 0, 0);
  }, []);

  const needsDrawingLayer =
    activeTool === "freehand_write" ||
    activeTool === "area_select" ||
    activeTool === "popup_note";

  const isEraser = activeTool === "eraser";
  const dpr =
    typeof window !== "undefined"
      ? Math.min(window.devicePixelRatio || 1, renderZoomLevel > 150 ? 1.5 : 2)
      : 1;

  const baseWidth = discoveredDim?.width ?? estimatedWidth;
  const baseHeight = discoveredDim?.height ?? estimatedHeight;
  const scale = zoomLevel / 100;
  const renderScale = renderZoomLevel / 100;
  const cssScale = zoomLevel / renderZoomLevel;

  return (
    <div
      ref={setRefs}
      data-page-number={pageNumber}
      onMouseUp={handleMouseUp}
      style={{
        width: Math.round(baseWidth * scale),
        height: Math.round(baseHeight * scale),
        cursor: toolCursor,
      }}
      className={cn(
        "relative overflow-hidden rounded-sm border border-border bg-white shadow-[var(--shadow-sm)] [&_.textLayer_::selection]:!bg-[#2563EB]/30 [&_.annotationLayer>section:not(.linkAnnotation)]:!hidden",
        activeTool !== "select" &&
          "[&_.textLayer]:!cursor-[inherit] [&_.textLayer_*]:!cursor-[inherit]",
        isRagHighlighted &&
          "ring-2 ring-[var(--accent-brand,#2563EB)] ring-offset-2 ring-offset-background",
      )}
    >
      {/* Persistent back-buffer canvas holds previous frame during async scale re-render */}
      <canvas
        ref={bufferCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      />

      {/* Live PDF page; CSS-scaled immediately while zoom is changing, then re-rendered at settled DPI */}
      <div
        style={
          cssScale !== 1
            ? {
                transform: `scale(${cssScale})`,
                transformOrigin: "top left",
                width: Math.round(baseWidth * renderScale),
                height: Math.round(baseHeight * renderScale),
              }
            : undefined
        }
        className="relative z-[1] [&_.react-pdf__Page]:!bg-transparent"
      >
        <Page
          pageNumber={pageNumber}
          scale={renderScale}
          devicePixelRatio={dpr}
          renderAnnotationLayer
          renderTextLayer
          loading={null}
          onLoadSuccess={handlePageLoadSuccess}
          onRenderSuccess={handlePageRenderSuccess}
        />
      </div>

      {/* Rendered text markups */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {textMarkups.map((annot) => (
          <div
            key={annot.id}
            className={cn(
              "pointer-events-none absolute inset-0",
              annot.toolType === "highlight" && "opacity-40 mix-blend-multiply",
            )}
          >
            {annot.rectSegments.map((seg, idx) => (
              <div
                key={`${annot.id}-${idx}`}
                onClick={
                  isEraser ? () => onDeleteAnnotation(annot.id) : undefined
                }
                style={{
                  left: `${seg.x * 100}%`,
                  top: `${seg.y * 100}%`,
                  width: `${seg.width * 100}%`,
                  height: `${seg.height * 100}%`,
                }}
                className={cn(
                  "absolute",
                  isEraser &&
                    "pointer-events-auto cursor-[inherit] hover:opacity-60",
                )}
              >
                {annot.toolType === "highlight" && (
                  <div
                    className="h-full w-full rounded-[2px]"
                    style={{ backgroundColor: annot.color }}
                  />
                )}
                {annot.toolType === "strikethrough" && (
                  <div
                    className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2"
                    style={{ backgroundColor: annot.color }}
                  />
                )}
                {annot.toolType === "underline" &&
                  (annot.underlineStyle === "squiggle" ? (
                    <svg
                      viewBox="0 0 100 8"
                      preserveAspectRatio="none"
                      className="absolute inset-x-0 bottom-0 h-[4px] w-full"
                    >
                      <path
                        d="M0 4 Q 6 0, 12 4 T 24 4 T 36 4 T 48 4 T 60 4 T 72 4 T 84 4 T 96 4 T 100 4"
                        fill="none"
                        stroke={annot.color}
                        strokeWidth="2"
                      />
                    </svg>
                  ) : (
                    <div
                      className="absolute inset-x-0 bottom-0 h-0 border-b-[2px]"
                      style={{
                        borderColor: annot.color,
                        borderStyle:
                          annot.underlineStyle === "dashed"
                            ? "dashed"
                            : "solid",
                      }}
                    />
                  ))}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Rendered SVG ink strokes */}
      <svg
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 z-20 h-full w-full"
      >
        {inkAnnotations.map((annot) => (
          <path
            key={annot.id}
            d={pointsToSvgPath(annot.points)}
            fill="none"
            stroke={annot.color}
            strokeWidth={annot.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            onClick={isEraser ? () => onDeleteAnnotation(annot.id) : undefined}
            className={cn(
              isEraser &&
                "pointer-events-auto cursor-[inherit] hover:opacity-50",
            )}
          />
        ))}

        {inkDraft && inkDraft.length > 1 && (
          <path
            d={pointsToSvgPath(inkDraft)}
            fill="none"
            stroke={activeColor}
            strokeWidth={activeStrokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Active pointer capture layer for ink, crop & note placement */}
      {needsDrawingLayer && (
        <div
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
          className="absolute inset-0 z-30 touch-none"
        />
      )}

      {/* Figure crop selection box */}
      {cropRect && (
        <div
          className="pointer-events-none absolute z-30 border border-[var(--accent-brand)] bg-[var(--selection-bg)]"
          style={{
            left: `${Math.min(cropRect.startX, cropRect.currX) * 100}%`,
            top: `${Math.min(cropRect.startY, cropRect.currY) * 100}%`,
            width: `${Math.abs(cropRect.currX - cropRect.startX) * 100}%`,
            height: `${Math.abs(cropRect.currY - cropRect.startY) * 100}%`,
          }}
        />
      )}

      {/* Note pins */}
      {noteAnnotations.map((note) => (
        <button
          key={note.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isEraser) onDeleteAnnotation(note.id);
            else onNoteClick(note, { x: e.clientX, y: e.clientY });
          }}
          title={note.comment || "Open note"}
          style={{
            left: `${note.x * 100}%`,
            top: `${note.y * 100}%`,
            backgroundColor: note.color,
          }}
          className={cn(
            "absolute z-30 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-black/15 text-black shadow-[var(--shadow-sm)] transition-colors duration-150 ease-[var(--ease-foliet)]",
            isEraser ? "cursor-[inherit]" : "cursor-pointer",
          )}
        >
          <MessageSquare size={14} strokeWidth={1.5} />
        </button>
      ))}

      {/* Visual RAG Highlight Match Banner */}
      {isRagHighlighted && activeRagHighlight && (
        <div
          role="status"
          aria-label="RAG search highlight"
          className="absolute top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--accent-brand,#2563EB)]/40 bg-card/95 px-3 py-1 text-xs shadow-md backdrop-blur-md animate-in fade-in zoom-in-95 duration-200 select-none"
        >
          <Sparkles
            size={13}
            className="text-[var(--accent-brand,#2563EB)] shrink-0"
          />
          <span className="font-semibold text-foreground shrink-0">
            RAG Match ({Math.round(activeRagHighlight.similarityScore * 100)}%)
          </span>
          <span className="max-w-[220px] truncate text-muted-foreground font-mono text-[11px] italic">
            "{activeRagHighlight.text.slice(0, 90)}"
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              useRagStore.getState().setActiveRagHighlight(null);
            }}
            title="Dismiss RAG highlight"
            className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      )}

      {/* Floating text selection action popover (Search Web / Ask Lio) */}
      {activeTool === "select" && selectionState && (
        <SelectionActionBar
          selectedText={selectionState.text}
          pageNumber={pageNumber}
          anchorRect={selectionState.rect}
          onClose={() => setSelectionState(null)}
        />
      )}
    </div>
  );
});
