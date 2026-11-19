import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, pdfjs } from "react-pdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { tinykeys } from "tinykeys";
import { AiStudioSidebar } from "@/components/ai/AiStudioSidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { NoteEditorPortal } from "@/components/viewer/NoteEditorPortal";
import { PdfPage } from "@/components/viewer/PdfPage";
import { PdfSidebar } from "@/components/viewer/PdfSidebar";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { SearchOverlay } from "@/components/viewer/SearchOverlay";
import { ViewerHeader } from "@/components/viewer/ViewerHeader";
import { usePdfSearch } from "@/hooks/usePdfSearch";
import { usePdfSession } from "@/hooks/usePdfSession";
import { usePdfZoom } from "@/hooks/usePdfZoom";
import { useToolManager } from "@/hooks/useToolManager";
import { PDF_DOCUMENT_OPTIONS } from "@/services/pdf";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import {
  useAnnotationStore,
  useAnnotationTemporal,
} from "@/stores/annotationStore";
import { getActivePdfSource, useDocumentStore } from "@/stores/documentStore";
import { useSummaryStore } from "@/stores/summaryStore";
import { useSystemStore } from "@/stores/systemStore";
import type { Dimensions } from "@/types/common";
import {
  type NoteAnnotation,
  type PdfAnnotation,
  isNoteAnnotation,
} from "@/types/annotations";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "@/styles/pdf-viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const EMPTY_ANNOTS: PdfAnnotation[] = [];
const DEFAULT_DIM: Dimensions = { width: 612, height: 792 };
const PAGE_GAP = 28;
const noop = () => {};

export function ViewerView() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);
  const sidebarOpen = useSystemStore((s) => s.sidebarOpen);
  const toggleSidebar = useSystemStore((s) => s.toggleSidebar);
  const isAiStudioOpen = useAiStudioStore((s) => s.isAiStudioOpen);
  const isSummaryWorkspaceOpen = useSummaryStore(
    (s) => s.isSummaryWorkspaceOpen,
  );
  const isRightPanelOpen = isAiStudioOpen || isSummaryWorkspaceOpen;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isRestoringPageRef = useRef(false);

  const [currentPage, setCurrentPage] = useState<number>(() =>
    Math.max(1, activeDoc?.lastPage || 1),
  );
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, Dimensions>
  >({});

  const pdfSource = useMemo(
    () => getActivePdfSource(activeDoc),
    [activeDoc?.filePath],
  );

  const annotations = useAnnotationStore((s) => s.annotations);
  const cropAnnotations = useAnnotationStore((s) => s.cropAnnotations);
  const bookmarks = useAnnotationStore((s) => s.bookmarks);
  const editingNoteId = useAnnotationStore((s) => s.editingNoteId);
  const noteAnchorPos = useAnnotationStore((s) => s.noteAnchorPos);

  const canUndo = useAnnotationTemporal((s) => s.pastStates.length > 0);
  const canRedo = useAnnotationTemporal((s) => s.futureStates.length > 0);
  const undo = useCallback(
    () => useAnnotationStore.temporal.getState().undo(),
    [],
  );
  const redo = useCallback(
    () => useAnnotationStore.temporal.getState().redo(),
    [],
  );

  const toolManager = useToolManager();

  const session = usePdfSession({
    activeDoc,
    currentPage,
    zoomLevel: activeDoc?.zoom || 100,
    jumpToPage: (p) => jumpToPage(p),
    isRestoringPageRef,
  });

  const {
    zoomLevel,
    renderZoom,
    isCtrlHeld,
    setZoomLevel,
    resetZoom,
    handleFitToWidth,
  } = usePdfZoom({
    initialZoom: activeDoc?.zoom || 100,
    scrollRef,
    pageDimensions,
    currentPage,
    pdfSource,
    pdfProxy: session.pdfProxy,
    isRestoringPageRef,
  });

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: session.totalPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index: number) => {
      const pageNum = index + 1;
      const dim = pageDimensions[pageNum] ?? pageDimensions[1] ?? DEFAULT_DIM;
      return Math.round((dim.height * zoomLevel) / 100);
    },
    gap: PAGE_GAP,
    overscan: 2,
  });

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [zoomLevel, pageDimensions, rowVirtualizer]);

  const jumpToPage = useCallback(
    (pageNum: number) => {
      const target = Math.min(session.totalPages, Math.max(1, pageNum));
      setCurrentPage(target);
      rowVirtualizer.scrollToIndex(target - 1, {
        align: "start",
        behavior: "auto",
      });
    },
    [session.totalPages, rowVirtualizer],
  );

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Scroll spy: update currentPage from visible item covering viewport focal point
  useEffect(() => {
    if (virtualItems.length === 0 || isRestoringPageRef.current) return;
    const container = scrollRef.current;
    if (!container) return;
    const focalY = container.scrollTop + container.clientHeight * 0.35;

    let closestItem = virtualItems[0];
    let minDistance = Infinity;

    for (const item of virtualItems) {
      const itemMid = item.start + item.size / 2;
      const dist = Math.abs(itemMid - focalY);
      if (dist < minDistance) {
        minDistance = dist;
        closestItem = item;
      }
    }

    if (closestItem) {
      const matchedPage = closestItem.index + 1;
      setCurrentPage((prev) => (prev !== matchedPage ? matchedPage : prev));
    }
  }, [virtualItems]);

  const search = usePdfSearch(session.pdfProxy, jumpToPage);

  const executeSave = useCallback(
    () =>
      useAnnotationStore.getState().saveAndBurn(activeDoc?.filePath, {
        lastPage: currentPage,
        zoom: zoomLevel,
        pageCount: session.totalPages,
      }),
    [activeDoc?.filePath, currentPage, zoomLevel, session.totalPages],
  );

  // Keyboard shortcuts via tinykeys
  useEffect(() => {
    return tinykeys(window, {
      "$mod+s": (e) => {
        e.preventDefault();
        void executeSave();
      },
      "$mod+f": (e) => {
        e.preventDefault();
        search.openSearch();
      },
      "$mod+z": (e) => {
        e.preventDefault();
        if (canUndo) undo();
      },
      "$mod+Shift+z": (e) => {
        e.preventDefault();
        if (canRedo) redo();
      },
      "$mod+y": (e) => {
        e.preventDefault();
        if (canRedo) redo();
      },
    });
  }, [executeSave, search, canUndo, canRedo, undo, redo]);

  const studioAnnotations = useMemo(
    () => [...annotations, ...cropAnnotations],
    [annotations, cropAnnotations],
  );

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, PdfAnnotation[]>();
    for (const a of annotations) {
      const list = grouped.get(a.pageNumber);
      if (list) list.push(a);
      else grouped.set(a.pageNumber, [a]);
    }
    return grouped;
  }, [annotations]);

  const editingNote = useMemo(() => {
    if (!editingNoteId) return null;
    const found = annotations.find((a) => a.id === editingNoteId);
    return found && isNoteAnnotation(found) ? found : null;
  }, [annotations, editingNoteId]);

  const handleDimensionsDiscovered = useCallback(
    (p: number, width: number, height: number) => {
      setPageDimensions((prev) =>
        prev[p]?.width === width && prev[p]?.height === height
          ? prev
          : { ...prev, [p]: { width, height } },
      );
    },
    [],
  );

  const handleDocumentItemClick = useCallback(
    async ({ pageNumber, dest }: { pageNumber?: number; dest?: unknown }) => {
      if (pageNumber) return jumpToPage(pageNumber);
      if (dest && session.pdfProxy) {
        try {
          const target =
            typeof dest === "string"
              ? await session.pdfProxy.getDestination(dest)
              : dest;
          if (Array.isArray(target) && target[0]) {
            jumpToPage((await session.pdfProxy.getPageIndex(target[0])) + 1);
          }
        } catch {}
      }
    },
    [jumpToPage, session.pdfProxy],
  );

  const handleNoteClick = useCallback(
    (note: NoteAnnotation, pos: { x: number; y: number }) =>
      useAnnotationStore.getState().setEditingNote(note.id, pos),
    [],
  );

  const handleAddFigureCrop = useCallback(
    (crop: {
      pageNumber: number;
      imageUrl: string;
      x: number;
      y: number;
      width: number;
      height: number;
      caption?: string;
    }) => useAnnotationStore.getState().addCrop(crop, activeDoc?.id),
    [activeDoc?.id],
  );

  const currentLabel =
    session.pageLabels[currentPage - 1] || String(currentPage);
  const isBookmarked = bookmarks.some((b) => b.pageNumber === currentPage);

  if (!activeDoc || !pdfSource) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-deep)]">
      <ViewerHeader
        currentPage={currentPage}
        totalPages={session.totalPages}
        currentLabel={currentLabel}
        zoomLevel={zoomLevel}
        isSidebarOpen={sidebarOpen}
        isCurrentPageBookmarked={isBookmarked}
        shortcutModifier={shortcutModifier}
        onToggleSidebar={toggleSidebar}
        onJumpToPage={jumpToPage}
        onCommitPageInput={(val) => {
          const clean = val.trim();
          const idx = session.pageLabels.findIndex(
            (l) => l.toLowerCase() === clean.toLowerCase(),
          );
          if (idx !== -1) return jumpToPage(idx + 1);
          const n = parseInt(clean, 10);
          if (!Number.isNaN(n)) jumpToPage(n);
        }}
        onZoomChange={setZoomLevel}
        onResetZoom={resetZoom}
        onFitToWidth={handleFitToWidth}
        onToggleBookmark={() =>
          useAnnotationStore.getState().toggleBookmark(currentPage)
        }
        onOpenSearch={search.openSearch}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ResizablePanelGroup orientation="horizontal" className="h-full w-full">
          {sidebarOpen && (
            <ResizablePanel
              id="pdf-sidebar"
              defaultSize="256px"
              minSize="200px"
              maxSize="560px"
            >
              <PdfSidebar
                isOpen={sidebarOpen}
                outline={session.outline}
                bookmarks={bookmarks}
                crops={cropAnnotations}
                currentPage={currentPage}
                pageLabels={session.pageLabels}
                onJumpToPage={jumpToPage}
                onAddBookmark={(p) =>
                  useAnnotationStore.getState().toggleBookmark(p)
                }
                onDeleteBookmark={(id) =>
                  useAnnotationStore.getState().deleteBookmark(id)
                }
                onDeleteCrop={(id) =>
                  useAnnotationStore.getState().deleteCrop(id, activeDoc?.id)
                }
              />
            </ResizablePanel>
          )}
          {sidebarOpen && (
            <ResizableHandle className="transition-colors hover:bg-[var(--accent-brand)]/60 active:bg-[var(--accent-brand)]" />
          )}

          <ResizablePanel id="pdf-viewer" minSize="220px">
            <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden">
              <PdfToolbar
                presets={toolManager.presets}
                activeState={toolManager.activeState}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                onTogglePreset={toolManager.togglePreset}
                onSetSelectMode={toolManager.setSelectMode}
                onSetStrokeWidth={toolManager.setStrokeWidth}
                onSetUnderlineStyle={toolManager.setUnderlineStyle}
                onAddPreset={async (p) => {
                  toolManager.addPreset(p);
                }}
                onUpdatePreset={async (p) => {
                  toolManager.updatePreset(p);
                }}
                onRemovePreset={async (id) => {
                  toolManager.removePreset(id);
                }}
                onResetPresets={async () => {
                  toolManager.resetPresets();
                }}
              />

              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                <SearchOverlay
                  isOpen={search.isSearchOpen}
                  searchQuery={search.searchQuery}
                  isSearching={search.isSearching}
                  totalMatches={search.searchResults.length}
                  currentMatchIndex={search.currentMatchIndex}
                  searchInputRef={search.searchInputRef}
                  onQueryChange={(q) => {
                    search.setSearchQuery(q);
                    search.executeSearch(q);
                  }}
                  onNext={search.handleSearchNext}
                  onPrev={search.handleSearchPrev}
                  onClose={search.closeSearch}
                />

                <div
                  ref={scrollRef}
                  className={`relative flex-1 overflow-auto p-6 ${isCtrlHeld ? "ctrl-active" : ""}`}
                >
                  <Document
                    file={pdfSource}
                    options={PDF_DOCUMENT_OPTIONS}
                    externalLinkTarget="_blank"
                    externalLinkRel="noopener noreferrer"
                    onItemClick={handleDocumentItemClick}
                    onLoadSuccess={session.handleDocumentLoadSuccess}
                    onLoadError={session.handleDocumentLoadError}
                    loading={null}
                  >
                    <div
                      style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: "100%",
                        position: "relative",
                      }}
                    >
                      {virtualItems.map((virtualRow: VirtualItem) => {
                        const pageNum = virtualRow.index + 1;
                        const dim =
                          pageDimensions[pageNum] ??
                          pageDimensions[1] ??
                          DEFAULT_DIM;

                        return (
                          <div
                            key={virtualRow.key}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              transform: `translateY(${virtualRow.start}px)`,
                              display: "flex",
                              justifyContent: "center",
                            }}
                          >
                            <PdfPage
                              pageNumber={pageNum}
                              zoomLevel={zoomLevel}
                              renderZoomLevel={renderZoom}
                              estimatedWidth={dim.width}
                              estimatedHeight={dim.height}
                              activeTool={toolManager.activeState.toolType}
                              activeColor={toolManager.activeState.color}
                              activeStrokeWidth={
                                toolManager.activeState.strokeWidth
                              }
                              activeUnderlineStyle={
                                toolManager.activeState.underlineStyle
                              }
                              pageAnnotations={
                                annotationsByPage.get(pageNum) ?? EMPTY_ANNOTS
                              }
                              registerPageRef={noop}
                              onAddAnnotation={
                                useAnnotationStore.getState().addAnnotation
                              }
                              onDeleteAnnotation={
                                useAnnotationStore.getState().deleteAnnotation
                              }
                              onNoteClick={handleNoteClick}
                              onAddFigureCrop={handleAddFigureCrop}
                              onDimensionsDiscovered={
                                handleDimensionsDiscovered
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </Document>
                </div>

                {isCtrlHeld && (
                  <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-[var(--shadow-sm)]">
                    Links active
                  </div>
                )}
              </div>
            </div>
          </ResizablePanel>

          {isRightPanelOpen && (
            <ResizableHandle className="transition-colors hover:bg-[var(--accent-brand)]/60 active:bg-[var(--accent-brand)]" />
          )}
          {isRightPanelOpen && (
            <ResizablePanel
              key={isSummaryWorkspaceOpen ? "summary-split" : "ai-studio"}
              id={isSummaryWorkspaceOpen ? "summary-split" : "ai-studio"}
              defaultSize={isSummaryWorkspaceOpen ? "540px" : "360px"}
              minSize={isSummaryWorkspaceOpen ? "380px" : "300px"}
              maxSize={isSummaryWorkspaceOpen ? "920px" : "620px"}
            >
              <AiStudioSidebar
                isOpen={isAiStudioOpen}
                onJumpToPage={jumpToPage}
                annotations={studioAnnotations}
              />
            </ResizablePanel>
          )}
        </ResizablePanelGroup>
      </div>

      <NoteEditorPortal
        note={editingNote}
        anchorPos={noteAnchorPos}
        onClose={() => useAnnotationStore.getState().setEditingNote(null)}
        onUpdateNote={(updated) =>
          useAnnotationStore.getState().updateAnnotation(updated)
        }
        onDeleteNote={(id) =>
          useAnnotationStore.getState().deleteAnnotation(id)
        }
      />
    </div>
  );
}

export default ViewerView;
