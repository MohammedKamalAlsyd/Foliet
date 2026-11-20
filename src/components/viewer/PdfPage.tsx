import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Page } from "react-pdf";
import { Eye, MoonStar, RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectionActionBar } from "@/components/viewer/SelectionActionBar";
import { CropAndNoteLayer } from "@/components/viewer/layers/CropAndNoteLayer";
import { InkLayer } from "@/components/viewer/layers/InkLayer";
import { TextMarkupLayer } from "@/components/viewer/layers/TextMarkupLayer";
import { getToolCursor } from "@/constants/toolCursors";
import { usePagePointerTools } from "@/hooks/usePagePointerTools";
import { useRagStore } from "@/stores/ragStore";
import { useSummaryStore } from "@/stores/summaryStore";
import { useSystemStore } from "@/stores/systemStore";
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
import {
  type PdfPageAppearanceAnalysis,
  type PdfPageOverride,
  analyzePdfCanvas,
  resolvePdfPageAppearance,
} from "@/utils/pdfDarkMode";

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
  const [pageAnalysis, setPageAnalysis] =
    useState<PdfPageAppearanceAnalysis | null>(null);
  const [pageOverride, setPageOverride] = useState<PdfPageOverride>("auto");
  const [settledRenderKey, setSettledRenderKey] = useState<string | null>(null);
  const hasAnalyzedCanvasRef = useRef(false);
  const hasAnalyzedTextRef = useRef(false);
  const latestRenderKeyRef = useRef<string>("");

  const isDark = useSystemStore((s) => s.isDark);
  const pdfDarkMode = useSystemStore((s) => s.pdfDarkMode);

  useEffect(() => {
    setPageAnalysis(null);
    setPageOverride("auto");
    setSettledRenderKey(null);
    hasAnalyzedCanvasRef.current = false;
    hasAnalyzedTextRef.current = false;
  }, [pageNumber]);

  const resolvedAppearance = useMemo(
    () =>
      resolvePdfPageAppearance({
        isAppDark: isDark,
        setting: pdfDarkMode,
        override: pageOverride,
        analysis: pageAnalysis,
      }),
    [isDark, pdfDarkMode, pageOverride, pageAnalysis],
  );

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

  // Snapshot rendered canvas into back-buffer so subsequent zoom re-renders never blink,
  // and analyze the raw un-filtered pixels once per page for intelligent dark-mode adaptation.
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

    // Reveal the crisp newly-rendered canvas now that painting is 100% complete
    setSettledRenderKey(latestRenderKeyRef.current);

    if (!hasAnalyzedCanvasRef.current) {
      hasAnalyzedCanvasRef.current = true;
      const textLayerEl = wrapper.querySelector(".textLayer");
      const textLength = textLayerEl
        ? (textLayerEl.textContent?.trim().length ?? 0)
        : undefined;
      if (textLength !== undefined && textLength > 0) {
        hasAnalyzedTextRef.current = true;
      }
      setPageAnalysis(analyzePdfCanvas(pdfCanvas, { pageNumber, textLength }));
    }
  }, [pageNumber]);

  // Refine classification once when the text layer first finishes rendering
  const handleTextLayerRenderSuccess = useCallback(() => {
    if (hasAnalyzedTextRef.current) return;
    const wrapper = wrapperRef.current;
    const buf = bufferCanvasRef.current;
    if (!wrapper || !buf || buf.width === 0 || buf.height === 0) return;
    hasAnalyzedTextRef.current = true;
    const textLayerEl = wrapper.querySelector(".textLayer");
    const textLength = textLayerEl?.textContent?.trim().length ?? 0;
    const nextAnalysis = analyzePdfCanvas(buf, { pageNumber, textLength });
    setPageAnalysis((prev) =>
      prev &&
      prev.classification === nextAnalysis.classification &&
      prev.smartFilter === nextAnalysis.smartFilter
        ? prev
        : nextAnalysis,
    );
  }, [pageNumber]);

  const handleTogglePageOverride = useCallback(() => {
    setPageOverride((prev) => {
      if (prev !== "auto") return "auto";
      return resolvedAppearance.isInverted ? "original" : "dark";
    });
  }, [resolvedAppearance.isInverted]);

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

  const currentRenderKey = `${pageNumber}:${renderScale}:${dpr}`;
  latestRenderKeyRef.current = currentRenderKey;
  const isLiveCanvasSettled = settledRenderKey === currentRenderKey;

  const pageContainerStyle = useMemo<CSSProperties>(() => {
    const style: Record<string, string | number> = {
      "--pdf-page-filter": resolvedAppearance.filter ?? "none",
    };
    if (cssScale !== 1) {
      style.transform = `scale(${cssScale})`;
      style.transformOrigin = "top left";
      style.width = Math.round(baseWidth * renderScale);
      style.height = Math.round(baseHeight * renderScale);
    }
    return style as CSSProperties;
  }, [
    resolvedAppearance.filter,
    cssScale,
    baseWidth,
    baseHeight,
    renderScale,
  ]);

  const showPageAppearanceControl =
    isDark && pdfDarkMode !== "original" && !needsDrawingLayer && !isEraser;
  const useDarkBackdrop =
    isDark && (resolvedAppearance.isDarkSurface || pageAnalysis === null);

  return (
    <div
      ref={setRefs}
      data-foliet-page={pageNumber}
      data-foliet-page-appearance={resolvedAppearance.classification}
      data-foliet-page-dark={resolvedAppearance.isDarkSurface ? "true" : "false"}
      onMouseUp={handleMouseUp}
      style={{
        width: Math.round(baseWidth * scale),
        height: Math.round(baseHeight * scale),
        cursor: toolCursor,
      }}
      className={cn(
        "group/page relative overflow-hidden rounded-sm border border-border shadow-[var(--shadow-sm)] [&_.annotationLayer>section:not(.linkAnnotation)]:!hidden",
        useDarkBackdrop ? "bg-[#19191b]" : "bg-white",
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
        style={{ filter: resolvedAppearance.filter }}
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      />

      {/* Live PDF page; CSS-scaled immediately while zoom is changing, hidden behind back-buffer while re-rendering at settled DPI */}
      <div
        style={pageContainerStyle}
        className={cn(
          "foliet-pdf-canvas-host relative z-[1] [&_.react-pdf__Page]:!bg-transparent",
          !isLiveCanvasSettled && "foliet-canvas-pending",
        )}
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
          onRenderTextLayerSuccess={handleTextLayerRenderSuccess}
        />
      </div>

      <TextMarkupLayer
        textMarkups={textMarkups}
        ragHighlight={activeRagHighlight}
        isDimensionsSettled={discoveredDim !== null}
        isDarkPage={resolvedAppearance.isDarkSurface}
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

      {/* Subtle per-page dark-mode status & 1-click override pill (visible on page hover or when overridden) */}
      {showPageAppearanceControl && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handleTogglePageOverride();
          }}
          aria-label={
            resolvedAppearance.isOverridden
              ? `Reset page ${pageNumber} to smart dark mode`
              : resolvedAppearance.isInverted
                ? `Show page ${pageNumber} in original colors`
                : `Force dark mode on page ${pageNumber}`
          }
          title={
            resolvedAppearance.isOverridden
              ? `${resolvedAppearance.reasonLabel} — click to restore Smart Auto`
              : resolvedAppearance.isInverted
                ? `${resolvedAppearance.reasonLabel} — click to view this page in original colors`
                : `${resolvedAppearance.reasonLabel} — click to force dark mode on this page`
          }
          className={cn(
            "absolute top-2.5 right-2.5 z-30 flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-md transition-all duration-150 select-none hover:border-foreground/20 hover:text-foreground",
            resolvedAppearance.isOverridden
              ? "opacity-85 hover:opacity-100"
              : "opacity-0 group-hover/page:opacity-100 focus-visible:opacity-100",
          )}
        >
          {resolvedAppearance.isOverridden ? (
            <RotateCcw size={12} strokeWidth={1.75} className="text-[var(--accent-brand)]" />
          ) : resolvedAppearance.isInverted ? (
            <Eye size={12} strokeWidth={1.75} />
          ) : (
            <MoonStar size={12} strokeWidth={1.75} className="text-[var(--accent-brand)]" />
          )}
          <span>
            {resolvedAppearance.isOverridden
              ? "Reset"
              : resolvedAppearance.isInverted
                ? resolvedAppearance.classification === "scanned-paper"
                  ? "Scanned · Original"
                  : "Original"
                : `${resolvedAppearance.reasonLabel} · Dark`}
          </span>
        </button>
      )}

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
