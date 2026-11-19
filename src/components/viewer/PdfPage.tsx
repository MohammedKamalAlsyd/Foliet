import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Page } from "react-pdf";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectionActionBar } from "@/components/viewer/SelectionActionBar";
import { CropAndNoteLayer } from "@/components/viewer/layers/CropAndNoteLayer";
import { InkLayer } from "@/components/viewer/layers/InkLayer";
import { TextMarkupLayer } from "@/components/viewer/layers/TextMarkupLayer";
import { getToolCursor } from "@/constants/toolCursors";
import { usePagePointerTools } from "@/hooks/usePagePointerTools";
import { useRagStore } from "@/stores/ragStore";
import { useSummaryStore } from "@/stores/summaryStore";
import {
  type CropAnnotation,
  type InkAnnotation,
  type NoteAnnotation,
  type PdfAnnotation,
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
    caption?: string;
  }) => Promise<CropAnnotation | void> | CropAnnotation | void;
  onDimensionsDiscovered: (page: number, width: number, height: number) => void;
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

  const activeRagHighlight = useRagStore((s) =>
    s.activeRagHighlight?.pageNumber === pageNumber
      ? s.activeRagHighlight
      : null,
  );
  const isSummaryWorkspaceOpen = useSummaryStore(
    (s) => s.isSummaryWorkspaceOpen,
  );
  const isRagHighlighted = Boolean(activeRagHighlight);
  const showRagMatchBanner = activeRagHighlight?.highlightKind === "rag";

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

  const {
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
  } = usePagePointerTools({
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
  });

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
  const isNonTextTool = isEraser || needsDrawingLayer;
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
      data-foliet-page={pageNumber}
      onMouseUp={handleMouseUp}
      style={{
        width: Math.round(baseWidth * scale),
        height: Math.round(baseHeight * scale),
        cursor: toolCursor,
      }}
      className={cn(
        "relative overflow-hidden rounded-sm border border-border bg-white shadow-[var(--shadow-sm)] [&_.annotationLayer>section:not(.linkAnnotation)]:!hidden",
        activeTool !== "select" &&
          "[&_.textLayer]:!cursor-[inherit] [&_.textLayer_*]:!cursor-[inherit]",
        isNonTextTool &&
          "select-none [&_.textLayer]:!select-none [&_.textLayer_*]:!select-none [&_.textLayer]:!pointer-events-none [&_.annotationLayer]:!pointer-events-none",
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

      <TextMarkupLayer
        textMarkups={textMarkups}
        ragHighlight={activeRagHighlight}
        isDimensionsSettled={discoveredDim !== null}
        isEraser={isEraser}
        onDeleteAnnotation={onDeleteAnnotation}
      />

      <InkLayer
        inkAnnotations={inkAnnotations}
        inkDraft={inkDraft}
        activeColor={activeColor}
        activeStrokeWidth={activeStrokeWidth}
        pageWidth={baseWidth}
        pageHeight={baseHeight}
        isEraser={isEraser}
        onDeleteAnnotation={onDeleteAnnotation}
      />

      {/* Active pointer capture layer for ink, crop & note placement */}
      {needsDrawingLayer && (
        <div
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handleOverlayPointerMove}
          onPointerUp={handleOverlayPointerUp}
          onPointerCancel={handleOverlayPointerCancel}
          className="absolute inset-0 z-30 touch-none"
        />
      )}

      <CropAndNoteLayer
        noteAnnotations={noteAnnotations}
        cropRect={cropRect}
        quickInsertCrop={quickInsertCrop}
        isSummaryWorkspaceOpen={isSummaryWorkspaceOpen}
        isEraser={isEraser}
        onDeleteAnnotation={onDeleteAnnotation}
        onNoteClick={onNoteClick}
        onDismissQuickInsert={dismissQuickInsert}
      />

      {/* Visual RAG Highlight Match Banner (only for genuine RAG search results) */}
      {showRagMatchBanner && activeRagHighlight && (
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
          selectionRange={selectionState.range}
          onClose={clearSelectionState}
        />
      )}
    </div>
  );
});
