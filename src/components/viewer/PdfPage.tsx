import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Page } from "react-pdf";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
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

    const rectSegments = Array.from(range.getClientRects())
      .map((r) => ({
        x: Math.max(0, (r.left - pageRect.left) / pageRect.width),
        y: Math.max(0, (r.top - pageRect.top) / pageRect.height),
        width: Math.min(1, r.width / pageRect.width),
        height: Math.min(1, r.height / pageRect.height),
      }))
      .filter((r) => r.width > 0.002 && r.height > 0.002);

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
      onMouseUp={handleTextMarkup}
      style={{
        width: Math.round(baseWidth * scale),
        height: Math.round(baseHeight * scale),
      }}
      className={cn(
        "relative overflow-hidden rounded-sm border border-border bg-white shadow-[var(--shadow-sm)]",
        (activeTool === "freehand_write" || activeTool === "area_select") &&
          "cursor-crosshair",
        activeTool === "popup_note" && "cursor-cell",
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
        {textMarkups.map((annot) =>
          annot.rectSegments.map((seg, idx) => (
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
                  "pointer-events-auto cursor-pointer hover:opacity-60",
              )}
            >
              {annot.toolType === "highlight" && (
                <div
                  className="h-full w-full rounded-[2px] opacity-35 mix-blend-multiply"
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
                        annot.underlineStyle === "dashed" ? "dashed" : "solid",
                    }}
                  />
                ))}
            </div>
          )),
        )}
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
              isEraser && "pointer-events-auto cursor-pointer hover:opacity-50",
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
          className="absolute z-30 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border border-black/15 text-black shadow-[var(--shadow-sm)] transition-colors duration-150 ease-[var(--ease-foliet)]"
        >
          <MessageSquare size={14} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
});
