import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, pdfjs } from "react-pdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { NoteEditorPortal } from "@/components/viewer/NoteEditorPortal";
import { PdfPage } from "@/components/viewer/PdfPage";
import { PdfSidebar } from "@/components/viewer/PdfSidebar";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { SearchOverlay } from "@/components/viewer/SearchOverlay";
import { ViewerHeader } from "@/components/viewer/ViewerHeader";
import { usePdfSearch } from "@/hooks/usePdfSearch";
import { usePdfVirtualizer } from "@/hooks/usePdfVirtualizer";
import { useToolManager } from "@/hooks/useToolManager";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { PDF_DOCUMENT_OPTIONS, PdfService } from "@/services/pdf";
import { BinaryStorage } from "@/services/storage/binary";
import { DocumentCatalogStorage } from "@/services/storage/catalog";
import { SettingsStorage } from "@/services/storage/settings";
import {
  getActivePdfBuffer,
  getActivePdfSource,
  useDocumentStore,
} from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";
import {
  type BurnableAnnotation,
  type CropAnnotation,
  type NoteAnnotation,
  type PdfAnnotation,
  isCropAnnotation,
} from "@/types/annotations";
import type {
  BookmarkItem,
  PageDimensions,
  PdfOutlineNode,
} from "@/types/document";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "@/styles/pdf-viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function ViewerView() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const isSaving = useDocumentStore((s) => s.isSaving);
  const setDirtySource = useDocumentStore((s) => s.setDirtySource);
  const clearDirty = useDocumentStore((s) => s.clearDirty);
  const setDocPageCount = useDocumentStore((s) => s.setDocPageCount);
  const setSaveExecutor = useDocumentStore((s) => s.setSaveExecutor);
  const saveDocument = useDocumentStore((s) => s.saveDocument);
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);

  const [pdfProxy, setPdfProxy] = useState<any | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState(activeDoc?.lastPage || 1);
  const [totalPages, setTotalPages] = useState(
    Math.max(1, activeDoc?.pages || 1),
  );
  const [zoomLevel, setZoomLevel] = useState(activeDoc?.zoom || 100);
  const [isExporting, setIsExporting] = useState(false);
  const [isCtrlHeld, setIsCtrlHeld] = useState(false);

  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [pageLabels, setPageLabels] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [cropAnnotations, setCropAnnotations] = useState<CropAnnotation[]>([]);
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, PageDimensions>
  >({});

  const [editingNote, setEditingNote] = useState<NoteAnnotation | null>(null);
  const [noteAnchorPos, setNoteAnchorPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollRef = useRef(false);
  const seededDocRef = useRef<string | null>(null);

  const toolManager = useToolManager();
  const { renderedPages } = usePdfVirtualizer(currentPage, totalPages, 3);
  const {
    state: annotations,
    set: setAnnotations,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetAnnotations,
    isDirty: isAnnotDirty,
    markSaved,
  } = useUndoRedo<PdfAnnotation[]>([]);

  const pdfSource = useMemo(() => getActivePdfSource(activeDoc), [activeDoc]);

  useEffect(() => {
    setDirtySource("annotations", isAnnotDirty);
  }, [isAnnotDirty, setDirtySource]);

  useEffect(() => {
    SettingsStorage.getPreferences()
      .then((prefs) => setSidebarOpen(prefs.sidebarOpen))
      .catch(() => {});
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      SettingsStorage.savePreferences({ sidebarOpen: next }).catch(() => {});
      return next;
    });
  }, []);

  const jumpToPage = useCallback(
    (pageNum: number) => {
      const target = Math.min(totalPages, Math.max(1, pageNum));
      setCurrentPage(target);
      const el = scrollRef.current?.querySelector(
        `[data-page-number="${target}"]`,
      );
      if (el) {
        programmaticScrollRef.current = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          programmaticScrollRef.current = false;
        }, 450);
      }
    },
    [totalPages],
  );

  const search = usePdfSearch(pdfProxy, jumpToPage);

  // Load saved annotations & bookmarks once per docId
  useEffect(() => {
    if (!activeDoc?.id) return;
    const docId = activeDoc.id;
    let active = true;
    seededDocRef.current = null;

    Promise.all([
      BinaryStorage.getAnnotations(docId),
      BinaryStorage.getBookmarks(docId),
    ])
      .then(([savedAnnots, savedBookmarks]) => {
        if (!active) return;
        const source =
          savedAnnots.length > 0
            ? savedAnnots
            : (activeDoc.extractedAnnotations ?? []);
        resetAnnotations(source.filter((a) => !isCropAnnotation(a)));
        setCropAnnotations(source.filter(isCropAnnotation));
        setBookmarks(savedBookmarks);
        clearDirty();
        if (savedAnnots.length > 0 || activeDoc.extractedAnnotations) {
          seededDocRef.current = docId;
        }
      })
      .catch(() => toast.error("Failed to load saved annotations"));

    return () => {
      active = false;
    };
  }, [activeDoc?.id]);

  // Apply lazy extracted annotations only if user hasn't edited yet
  useEffect(() => {
    if (
      !activeDoc?.id ||
      seededDocRef.current === activeDoc.id ||
      !activeDoc.extractedAnnotations?.length ||
      isAnnotDirty
    ) {
      return;
    }
    seededDocRef.current = activeDoc.id;
    resetAnnotations(
      activeDoc.extractedAnnotations.filter((a) => !isCropAnnotation(a)),
    );
  }, [
    activeDoc?.id,
    activeDoc?.extractedAnnotations,
    isAnnotDirty,
    resetAnnotations,
  ]);

  // Persist reading state (page, zoom, note count) back to library catalog
  useEffect(() => {
    if (!activeDoc?.id) return;
    const docId = activeDoc.id;
    const timer = setTimeout(() => {
      DocumentCatalogStorage.updateDocument(docId, {
        lastPage: currentPage,
        zoom: zoomLevel,
        pageCount: totalPages,
        annotationCount: annotations.length + cropAnnotations.length,
      }).catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [
    activeDoc?.id,
    currentPage,
    zoomLevel,
    totalPages,
    annotations.length,
    cropAnnotations.length,
  ]);

  // Scroll spy
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let rafId: number | null = null;

    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const focalY = rect.top + rect.height * 0.35;
        const nodes =
          container.querySelectorAll<HTMLElement>("[data-page-number]");
        let closestPage: number | null = null;
        let minDist = Infinity;

        nodes.forEach((el) => {
          const r = el.getBoundingClientRect();
          const p = parseInt(el.dataset.pageNumber || "", 10);
          if (Number.isNaN(p)) return;
          if (r.top <= focalY && r.bottom >= focalY) {
            closestPage = p;
            minDist = 0;
          } else if (minDist > 0) {
            const d = Math.min(
              Math.abs(r.top - focalY),
              Math.abs(r.bottom - focalY),
            );
            if (d < minDist) {
              minDist = d;
              closestPage = p;
            }
          }
        });

        if (closestPage !== null) {
          setCurrentPage((prev) =>
            prev !== closestPage ? closestPage! : prev,
          );
        }
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [zoomLevel, totalPages]);

  const burnableAnnotations = useMemo(
    () =>
      annotations.filter(
        (a): a is BurnableAnnotation => a.toolType !== "area_select",
      ),
    [annotations],
  );

  const executeSave = useCallback(async (): Promise<boolean> => {
    if (!activeDoc?.id) return false;
    const docId = activeDoc.id;

    try {
      await Promise.all([
        BinaryStorage.saveAnnotations(docId, [
          ...annotations,
          ...cropAnnotations,
        ]),
        BinaryStorage.saveBookmarks(docId, bookmarks),
        DocumentCatalogStorage.updateDocument(docId, {
          lastPage: currentPage,
          zoom: zoomLevel,
          pageCount: totalPages,
          annotationCount: annotations.length + cropAnnotations.length,
        }),
      ]);

      if (activeDoc.filePath) {
        await PdfService.burnAndSave(
          activeDoc.filePath,
          burnableAnnotations,
          getActivePdfBuffer(),
        );
      }

      markSaved();
      clearDirty();
      toast.success("Saved");
      return true;
    } catch (err: any) {
      toast.error(err?.message || "Failed to save PDF");
      return false;
    }
  }, [
    activeDoc,
    annotations,
    cropAnnotations,
    bookmarks,
    currentPage,
    zoomLevel,
    totalPages,
    burnableAnnotations,
    markSaved,
    clearDirty,
  ]);

  useEffect(() => {
    setSaveExecutor(executeSave);
    return () => setSaveExecutor(null);
  }, [setSaveExecutor, executeSave]);

  const handleExport = useCallback(async () => {
    if (!activeDoc?.filePath) {
      toast.error("No source file available to export");
      return;
    }
    setIsExporting(true);
    try {
      const savedPath = await PdfService.exportDocument(
        activeDoc.filePath,
        burnableAnnotations,
        activeDoc.title,
        getActivePdfBuffer(),
      );
      if (savedPath) toast.success("PDF exported");
    } catch (err: any) {
      toast.error(err?.message || "Export failed");
    } finally {
      setIsExporting(false);
    }
  }, [activeDoc, burnableAnnotations]);

  // Keyboard shortcuts & Ctrl/Cmd hyperlink modifier
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") setIsCtrlHeld(true);

      const inSearch = document.activeElement === search.searchInputRef.current;
      if (search.isSearchOpen && inSearch) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.shiftKey ? search.handleSearchPrev() : search.handleSearchNext();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          search.closeSearch();
          return;
        }
      }

      const tag = document.activeElement?.tagName;
      if ((tag === "INPUT" || tag === "TEXTAREA") && !inSearch) return;

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "s") {
          e.preventDefault();
          saveDocument();
        } else if (key === "f") {
          e.preventDefault();
          search.openSearch();
        } else if (key === "z") {
          e.preventDefault();
          if (e.shiftKey) canRedo && redo();
          else canUndo && undo();
        } else if (key === "y") {
          e.preventDefault();
          canRedo && redo();
        }
      }
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
  }, [search, saveDocument, canUndo, canRedo, undo, redo]);

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
  }, []);

  const currentLabel = pageLabels[currentPage - 1] || String(currentPage);
  const isBookmarked = bookmarks.some((b) => b.pageNumber === currentPage);

  const toggleBookmark = useCallback(
    (page = currentPage) => {
      setBookmarks((prev) =>
        prev.some((b) => b.pageNumber === page)
          ? prev.filter((b) => b.pageNumber !== page)
          : [
              ...prev,
              {
                id: `bm-${Date.now()}`,
                pageNumber: page,
                title: `Page ${pageLabels[page - 1] || page}`,
                createdAt: new Date().toISOString(),
              },
            ],
      );
      setDirtySource("bookmarks", true);
    },
    [currentPage, pageLabels, setDirtySource],
  );

  const handleFitToWidth = useCallback(() => {
    if (!scrollRef.current) return;
    const avail = scrollRef.current.clientWidth - 48;
    const dim = pageDimensions[currentPage] ??
      pageDimensions[1] ?? { width: 612, height: 792 };
    if (dim.width > 0) {
      setZoomLevel(
        Math.min(500, Math.max(25, Math.floor((avail / dim.width) * 100))),
      );
    }
  }, [pageDimensions, currentPage]);

  if (!activeDoc || !pdfSource) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-deep)]">
      <ViewerHeader
        currentPage={currentPage}
        totalPages={totalPages}
        currentLabel={currentLabel}
        zoomLevel={zoomLevel}
        isSidebarOpen={sidebarOpen}
        isCurrentPageBookmarked={isBookmarked}
        isDirty={isDirty}
        isSaving={isSaving}
        isExporting={isExporting}
        shortcutModifier={shortcutModifier}
        onToggleSidebar={toggleSidebar}
        onJumpToPage={jumpToPage}
        onCommitPageInput={(val) => {
          const clean = val.trim();
          const idx = pageLabels.findIndex(
            (l) => l.toLowerCase() === clean.toLowerCase(),
          );
          if (idx !== -1) return jumpToPage(idx + 1);
          const n = parseInt(clean, 10);
          if (!Number.isNaN(n)) jumpToPage(n);
        }}
        onZoomChange={setZoomLevel}
        onResetZoom={() => setZoomLevel(100)}
        onFitToWidth={handleFitToWidth}
        onToggleBookmark={() => toggleBookmark(currentPage)}
        onOpenSearch={search.openSearch}
        onSave={saveDocument}
        onExport={handleExport}
      />

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
        onAddPreset={toolManager.addPreset}
        onUpdatePreset={toolManager.updatePreset}
        onRemovePreset={toolManager.removePreset}
        onResetPresets={toolManager.resetPresets}
      />

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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <PdfSidebar
          isOpen={sidebarOpen}
          outline={outline}
          bookmarks={bookmarks}
          crops={cropAnnotations}
          currentPage={currentPage}
          pageLabels={pageLabels}
          onJumpToPage={jumpToPage}
          onAddBookmark={(p) => toggleBookmark(p)}
          onDeleteBookmark={(id) => {
            setBookmarks((prev) => prev.filter((b) => b.id !== id));
            setDirtySource("bookmarks", true);
          }}
          onDeleteCrop={async (id) => {
            await BinaryStorage.deleteFigureCrop(id);
            setCropAnnotations((prev) => prev.filter((c) => c.id !== id));
            setDirtySource("crops", true);
          }}
        />

        <div
          ref={scrollRef}
          className={`flex-1 overflow-auto p-6 ${isCtrlHeld ? "ctrl-active" : ""}`}
        >
          <Document
            file={pdfSource}
            options={PDF_DOCUMENT_OPTIONS}
            externalLinkTarget="_blank"
            externalLinkRel="noopener noreferrer"
            onItemClick={async ({ pageNumber, dest }) => {
              if (pageNumber) return jumpToPage(pageNumber);
              if (dest && pdfProxy) {
                try {
                  const target =
                    typeof dest === "string"
                      ? await pdfProxy.getDestination(dest)
                      : dest;
                  if (Array.isArray(target) && target[0]) {
                    jumpToPage((await pdfProxy.getPageIndex(target[0])) + 1);
                  }
                } catch {}
              }
            }}
            onLoadSuccess={async (loaded) => {
              setPdfProxy(loaded);
              setTotalPages(loaded.numPages);
              setDocPageCount(activeDoc.id, loaded.numPages);

              const [nextOutline, nextLabels] = await Promise.all([
                PdfService.extractOutline(loaded).catch(() => []),
                PdfService.extractPageLabels(loaded).catch(() => null),
              ]);
              setOutline(nextOutline);
              if (nextLabels) setPageLabels(nextLabels);

              if (activeDoc.lastPage && activeDoc.lastPage > 1) {
                requestAnimationFrame(() => jumpToPage(activeDoc.lastPage!));
              }
            }}
            onLoadError={(err) =>
              toast.error(err?.message || "Failed to load PDF")
            }
            loading={
              <div className="flex h-64 items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
                <span>Loading document</span>
              </div>
            }
          >
            <div className="mx-auto flex flex-col items-center gap-6">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (pageNum) => {
                  const dim = pageDimensions[pageNum] ??
                    pageDimensions[1] ?? { width: 612, height: 792 };
                  const w = (dim.width * zoomLevel) / 100;
                  const h = (dim.height * zoomLevel) / 100;

                  return renderedPages.has(pageNum) ? (
                    <PdfPage
                      key={pageNum}
                      pageNumber={pageNum}
                      zoomLevel={zoomLevel}
                      activeTool={toolManager.activeState.toolType}
                      activeColor={toolManager.activeState.color}
                      activeStrokeWidth={toolManager.activeState.strokeWidth}
                      activeUnderlineStyle={
                        toolManager.activeState.underlineStyle
                      }
                      annotations={annotations}
                      onAddAnnotation={(annot) =>
                        setAnnotations((prev) => [...prev, annot])
                      }
                      onDeleteAnnotation={(id) =>
                        setAnnotations((prev) =>
                          prev.filter((a) => a.id !== id),
                        )
                      }
                      onNoteClick={(note, pos) => {
                        setEditingNote(note);
                        setNoteAnchorPos(pos);
                      }}
                      onAddFigureCrop={async (crop) => {
                        const id = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                        await BinaryStorage.saveFigureCrop(id, crop.imageUrl);
                        setCropAnnotations((prev) => [
                          {
                            id,
                            pageNumber: crop.pageNumber,
                            toolType: "area_select",
                            color: "#06B6D4",
                            imageUrl: `idb://${id}`,
                            createdAt: new Date().toISOString(),
                            x: crop.x,
                            y: crop.y,
                            width: crop.width,
                            height: crop.height,
                          },
                          ...prev,
                        ]);
                        setDirtySource("crops", true);
                        toast.success("Figure captured");
                      }}
                      onDimensionsDiscovered={(p, width, height) =>
                        setPageDimensions((prev) =>
                          prev[p]?.width === width && prev[p]?.height === height
                            ? prev
                            : { ...prev, [p]: { width, height } },
                        )
                      }
                    />
                  ) : (
                    <div
                      key={pageNum}
                      data-page-number={pageNum}
                      style={{ width: w, height: h }}
                      className="flex items-center justify-center rounded-sm border border-border bg-card font-mono text-xs tabular-nums text-muted-foreground select-none"
                    >
                      Page {pageLabels[pageNum - 1] || pageNum}
                    </div>
                  );
                },
              )}
            </div>
          </Document>
        </div>

        {isCtrlHeld && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-[var(--shadow-sm)]">
            Links active
          </div>
        )}
      </div>

      <NoteEditorPortal
        note={editingNote}
        anchorPos={noteAnchorPos}
        onClose={() => {
          setEditingNote(null);
          setNoteAnchorPos(null);
        }}
        onUpdateNote={(updated) => {
          setEditingNote(updated);
          setAnnotations((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a)),
          );
        }}
        onDeleteNote={(id) => {
          setAnnotations((prev) => prev.filter((a) => a.id !== id));
          setEditingNote(null);
          setNoteAnchorPos(null);
        }}
      />
    </div>
  );
}

export default ViewerView;
