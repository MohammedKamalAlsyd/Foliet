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
import { toast } from "sonner";
import { NoteEditorPortal } from "@/components/viewer/NoteEditorPortal";
import { PdfPage } from "@/components/viewer/PdfPage";
import { PdfSidebar } from "@/components/viewer/PdfSidebar";
import { AiStudioSidebar } from "@/components/ai/AiStudioSidebar";
import { PdfToolbar } from "@/components/viewer/PdfToolbar";
import { SearchOverlay } from "@/components/viewer/SearchOverlay";
import { ViewerHeader } from "@/components/viewer/ViewerHeader";
import { usePdfSearch } from "@/hooks/usePdfSearch";
import { useToolManager } from "@/hooks/useToolManager";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { PDF_DOCUMENT_OPTIONS, PdfService } from "@/services/pdf";
import { DocumentCatalogStorage } from "@/services/storage/catalog";
import { DocumentDatabase } from "@/services/storage/database";
import { SettingsStorage } from "@/services/storage/settings";
import { getActivePdfSource, useDocumentStore } from "@/stores/documentStore";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useSummaryStore } from "@/stores/summaryStore";
import { useSystemStore } from "@/stores/systemStore";
import {
  type BurnableAnnotation,
  type CropAnnotation,
  type NoteAnnotation,
  type PdfAnnotation,
  isCropAnnotation,
  isNoteAnnotation,
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

const EMPTY_ANNOTS: PdfAnnotation[] = [];
const MAX_RENDERED_PAGES = 18;
const DEFAULT_DIM: PageDimensions = { width: 612, height: 792 };

const sameBookmarks = (a: BookmarkItem[], b: BookmarkItem[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.id === b[i].id &&
      x.pageNumber === b[i].pageNumber &&
      x.title === b[i].title,
  );

const sameCrops = (a: CropAnnotation[], b: CropAnnotation[]) =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id);

export function ViewerView() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const setDirtySource = useDocumentStore((s) => s.setDirtySource);
  const clearDirty = useDocumentStore((s) => s.clearDirty);
  const setDocPageCount = useDocumentStore((s) => s.setDocPageCount);
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);
  const isAiStudioOpen = useAiStudioStore((s) => s.isAiStudioOpen);

  const [pdfProxy, setPdfProxy] = useState<any | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState<number>(() =>
    Math.max(1, activeDoc?.lastPage || 1),
  );
  const [totalPages, setTotalPages] = useState<number>(() =>
    Math.max(1, activeDoc?.pages || 1),
  );
  const [zoomLevel, setZoomLevel] = useState<number>(
    () => activeDoc?.zoom || 100,
  );
  const [renderZoom, setRenderZoom] = useState<number>(
    () => activeDoc?.zoom || 100,
  );
  const [isCtrlHeld, setIsCtrlHeld] = useState(false);

  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [pageLabels, setPageLabels] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [cropAnnotations, setCropAnnotations] = useState<CropAnnotation[]>([]);
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, PageDimensions>
  >({});

  const [renderedPages, setRenderedPages] = useState<Set<number>>(() => {
    const start = Math.max(1, activeDoc?.lastPage || 1);
    return new Set([Math.max(1, start - 1), start, start + 1]);
  });

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteAnchorPos, setNoteAnchorPos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pagesContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefsMap = useRef<Map<number, HTMLElement>>(new Map());
  const pageRefCallbacksRef = useRef<
    Map<number, (el: HTMLElement | null) => void>
  >(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const visiblePagesRef = useRef<Set<number>>(new Set());
  const programmaticScrollRef = useRef(false);
  const pendingRestorePageRef = useRef<number | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef = useRef<number>(activeDoc?.zoom || 100);
  const lastScrollTopRef = useRef(0);
  const scrollDirectionRef = useRef<1 | -1>(1);
  const isJumpingScrollRef = useRef(false);
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const seededDocRef = useRef<string | null>(null);
  const hasEditedAnnotationsRef = useRef(false);
  const savedBookmarksRef = useRef<BookmarkItem[]>([]);
  const savedCropsRef = useRef<CropAnnotation[]>([]);
  const prevPageAnnotsRef = useRef<Map<number, PdfAnnotation[]>>(new Map());

  const toolManager = useToolManager();
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

  const studioAnnotations = useMemo(
    () => [...annotations, ...cropAnnotations],
    [annotations, cropAnnotations],
  );

  const pdfSource = useMemo(
    () => getActivePdfSource(activeDoc),
    [activeDoc?.filePath],
  );
  const noopRegisterPageRef = useCallback(() => {}, []);

  // Stable wrapper refs so IntersectionObserver never loses or thrashes observed nodes
  const registerPageRef = useCallback(
    (pageNumber: number, el: HTMLElement | null) => {
      const prev = pageRefsMap.current.get(pageNumber);
      if (prev === el) return;
      if (prev) {
        observerRef.current?.unobserve(prev);
      }
      if (el) {
        pageRefsMap.current.set(pageNumber, el);
        observerRef.current?.observe(el);
      } else {
        pageRefsMap.current.delete(pageNumber);
      }
    },
    [],
  );

  const getPageRefCallback = useCallback(
    (pageNumber: number) => {
      let cb = pageRefCallbacksRef.current.get(pageNumber);
      if (!cb) {
        cb = (el: HTMLElement | null) => registerPageRef(pageNumber, el);
        pageRefCallbacksRef.current.set(pageNumber, cb);
      }
      return cb;
    },
    [registerPageRef],
  );

  const syncRenderedPages = useCallback(
    (anchorPage: number, maxPages: number) => {
      const dir = scrollDirectionRef.current;
      const startOffset = dir === 1 ? -2 : -4;
      const endOffset = dir === 1 ? 4 : 2;

      setRenderedPages((prev) => {
        const next = new Set<number>(prev);
        for (const p of visiblePagesRef.current) {
          if (p >= 1 && p <= maxPages) next.add(p);
        }
        for (let d = startOffset; d <= endOffset; d++) {
          const p = anchorPage + d;
          if (p >= 1 && p <= maxPages) next.add(p);
        }

        const candidate =
          next.size > MAX_RENDERED_PAGES
            ? new Set(
                Array.from(next)
                  .filter((p) => p >= 1 && p <= maxPages)
                  .sort(
                    (a, b) =>
                      Math.abs(a - anchorPage) - Math.abs(b - anchorPage),
                  )
                  .slice(0, MAX_RENDERED_PAGES),
              )
            : next;

        if (
          candidate.size === prev.size &&
          Array.from(candidate).every((p) => prev.has(p))
        ) {
          return prev;
        }
        return candidate;
      });
    },
    [],
  );

  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, PdfAnnotation[]>();
    for (const a of annotations) {
      const list = grouped.get(a.pageNumber);
      if (list) list.push(a);
      else grouped.set(a.pageNumber, [a]);
    }
    const nextCache = new Map<number, PdfAnnotation[]>();
    for (const [pageNum, list] of grouped) {
      const prev = prevPageAnnotsRef.current.get(pageNum);
      if (
        prev &&
        prev.length === list.length &&
        prev.every((item, i) => item === list[i])
      ) {
        nextCache.set(pageNum, prev);
      } else {
        nextCache.set(pageNum, list);
      }
    }
    prevPageAnnotsRef.current = nextCache;
    return nextCache;
  }, [annotations]);

  const editingNote = useMemo(() => {
    if (!editingNoteId) return null;
    const found = annotations.find((a) => a.id === editingNoteId);
    return found && isNoteAnnotation(found) ? found : null;
  }, [annotations, editingNoteId]);

  useEffect(() => {
    setDirtySource("annotations", isAnnotDirty);
  }, [isAnnotDirty, setDirtySource]);

  useEffect(() => {
    setDirtySource(
      "bookmarks",
      !sameBookmarks(bookmarks, savedBookmarksRef.current),
    );
  }, [bookmarks, setDirtySource]);

  useEffect(() => {
    setDirtySource("crops", !sameCrops(cropAnnotations, savedCropsRef.current));
  }, [cropAnnotations, setDirtySource]);

  useEffect(() => {
    SettingsStorage.getPreferences()
      .then((prefs) => setSidebarOpen(prefs.sidebarOpen))
      .catch(() => {});
  }, []);

  // Sync AI-captured crops (`add_figure_to_summary`) into Viewer state
  useEffect(() => {
    const onCropSaved = (e: Event) => {
      const detail = (
        e as CustomEvent<{ docId?: string; crop?: CropAnnotation }>
      ).detail;
      if (!detail?.crop) return;
      if (detail.docId && activeDoc?.id && detail.docId !== activeDoc.id) {
        return;
      }
      setCropAnnotations((prev) => {
        if (prev.some((c) => c.id === detail.crop!.id)) return prev;
        const next = [detail.crop!, ...prev];
        savedCropsRef.current = next;
        return next;
      });
    };
    window.addEventListener("foliet:crop-saved", onCropSaved);
    return () => window.removeEventListener("foliet:crop-saved", onCropSaved);
  }, [activeDoc?.id]);

  // Sync AI-created annotations (`highlight_passage`) into Viewer state
  useEffect(() => {
    const onAnnotationSaved = (e: Event) => {
      const detail = (
        e as CustomEvent<{ docId?: string; annotation?: PdfAnnotation }>
      ).detail;
      if (!detail?.annotation) return;
      if (detail.docId && activeDoc?.id && detail.docId !== activeDoc.id) {
        return;
      }
      const incoming = detail.annotation;
      if (isCropAnnotation(incoming)) return;
      setAnnotations((prev) =>
        prev.some((a) => a.id === incoming.id) ? prev : [...prev, incoming],
      );
    };
    window.addEventListener("foliet:annotation-saved", onAnnotationSaved);
    return () =>
      window.removeEventListener("foliet:annotation-saved", onAnnotationSaved);
  }, [activeDoc?.id, setAnnotations]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      SettingsStorage.savePreferences({ sidebarOpen: next }).catch(() => {});
      return next;
    });
  }, []);

  // Debounce live canvas re-render during rapid zooming so CSS-scale carries 60fps feedback
  useEffect(() => {
    if (renderZoom === zoomLevel) return;
    const timer = setTimeout(() => {
      setRenderZoom(zoomLevel);
    }, 140);
    return () => clearTimeout(timer);
  }, [zoomLevel, renderZoom]);

  // Keep viewport reading center anchored proportionally when zoom changes
  useLayoutEffect(() => {
    const prevZoom = prevZoomRef.current;
    prevZoomRef.current = zoomLevel;
    if (
      prevZoom === zoomLevel ||
      !scrollRef.current ||
      pendingRestorePageRef.current !== null
    ) {
      return;
    }
    const container = scrollRef.current;
    const ratio = zoomLevel / prevZoom;
    const centerY = container.scrollTop + container.clientHeight / 2;
    programmaticScrollRef.current = true;
    container.scrollTop = Math.max(
      0,
      centerY * ratio - container.clientHeight / 2,
    );
    requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }, [zoomLevel]);

  const jumpToPage = useCallback(
    (pageNum: number) => {
      const target = Math.min(totalPages, Math.max(1, pageNum));
      const container = scrollRef.current;
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
      }
      programmaticScrollRef.current = true;
      setCurrentPage(target);
      syncRenderedPages(target, totalPages);

      requestAnimationFrame(() => {
        const el = pageRefsMap.current.get(target);
        if (container && el) {
          const topDelta =
            el.getBoundingClientRect().top -
            container.getBoundingClientRect().top;
          container.scrollTo({
            top: Math.max(0, container.scrollTop + topDelta - 24),
            behavior: "auto",
          });
        }
        restoreTimerRef.current = setTimeout(() => {
          programmaticScrollRef.current = false;
          pendingRestorePageRef.current = null;
        }, 60);
      });
    },
    [totalPages, syncRenderedPages],
  );

  const search = usePdfSearch(pdfProxy, jumpToPage);

  // Reset per-document state & load saved annotations/bookmarks
  useEffect(() => {
    if (!activeDoc?.id) return;
    const docId = activeDoc.id;
    const initialPage = Math.max(1, activeDoc.lastPage || 1);
    const initialPages = Math.max(1, activeDoc.pages || 1);
    const initialZoom = activeDoc.zoom || 100;
    let active = true;

    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
    programmaticScrollRef.current = false;
    setPdfProxy(null);
    useSummaryStore.getState().setPdfProxy(null);
    useSummaryStore.getState().setChapters([]);
    setOutline([]);
    setPageLabels([]);
    setPageDimensions({});
    setEditingNoteId(null);
    setNoteAnchorPos(null);
    setTotalPages(initialPages);
    setZoomLevel(initialZoom);
    setRenderZoom(initialZoom);
    prevZoomRef.current = initialZoom;
    setCurrentPage(initialPage);
    setRenderedPages(
      new Set(
        [initialPage - 1, initialPage, initialPage + 1, initialPage + 2].filter(
          (p) => p >= 1 && p <= initialPages,
        ),
      ),
    );
    visiblePagesRef.current.clear();
    pendingRestorePageRef.current = initialPage > 1 ? initialPage : null;
    seededDocRef.current = null;
    hasEditedAnnotationsRef.current = false;

    Promise.all([
      DocumentDatabase.getAnnotations(docId),
      DocumentDatabase.getBookmarks(docId),
    ])
      .then(([savedAnnots, savedBookmarks]) => {
        if (!active) return;
        const source =
          savedAnnots.length > 0
            ? savedAnnots
            : (activeDoc.extractedAnnotations ?? []);
        const nonCrop = source.filter((a) => !isCropAnnotation(a));
        const crops = source.filter(isCropAnnotation);

        resetAnnotations(nonCrop);
        savedCropsRef.current = crops;
        setCropAnnotations(crops);
        savedBookmarksRef.current = savedBookmarks;
        setBookmarks(savedBookmarks);
        clearDirty();

        if (savedAnnots.length > 0 || activeDoc.extractedAnnotations) {
          seededDocRef.current = docId;
        }
      })
      .catch(() => toast.error("Failed to load saved annotations"));

    return () => {
      active = false;
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, [activeDoc?.id, resetAnnotations, clearDirty]);

  // Apply lazy extracted annotations only if user hasn't edited yet
  useEffect(() => {
    if (
      !activeDoc?.id ||
      seededDocRef.current === activeDoc.id ||
      hasEditedAnnotationsRef.current ||
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

  // Track latest reading state for debounced + guaranteed unmount/switch flush
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
    annotationCount: annotations.length + cropAnnotations.length,
    ready: Boolean(pdfProxy) && pendingRestorePageRef.current === null,
  };

  useEffect(() => {
    if (!activeDoc?.id || !pdfProxy || pendingRestorePageRef.current !== null) {
      return;
    }
    const { docId, lastPage, zoom, pageCount, annotationCount } =
      readingStateRef.current;
    const timer = setTimeout(() => {
      DocumentCatalogStorage.updateDocument(docId, {
        lastPage,
        zoom,
        pageCount,
        annotationCount,
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [
    activeDoc?.id,
    pdfProxy,
    currentPage,
    zoomLevel,
    totalPages,
    annotations.length,
    cropAnnotations.length,
  ]);

  // Flush reading position immediately on close / doc change / window unload
  useEffect(() => {
    const flush = () => {
      const s = readingStateRef.current;
      if (s.docId && s.ready) {
        DocumentCatalogStorage.updateDocument(s.docId, {
          lastPage: s.lastPage,
          zoom: s.zoom,
          pageCount: s.pageCount,
          annotationCount: s.annotationCount,
        }).catch(() => {});
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [activeDoc?.id]);

  // Pre-render surrounding pages smoothly as currentPage advances
  useEffect(() => {
    if (!pdfProxy || isJumpingScrollRef.current) return;
    syncRenderedPages(currentPage, totalPages);
  }, [pdfProxy, currentPage, totalPages, syncRenderedPages]);

  const totalPagesRef = useRef(totalPages);
  totalPagesRef.current = totalPages;

  // IntersectionObserver with generous 1500px margin so pages mount before scrolling into view
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pdfProxy) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageNum = Number(
            (entry.target as HTMLElement).dataset.pageNumber,
          );
          if (!pageNum) continue;
          if (entry.isIntersecting) visiblePagesRef.current.add(pageNum);
          else visiblePagesRef.current.delete(pageNum);
        }
        if (!isJumpingScrollRef.current) {
          syncRenderedPages(
            readingStateRef.current.lastPage,
            totalPagesRef.current,
          );
        }
      },
      { root, rootMargin: "1500px 0px" },
    );

    observerRef.current = observer;
    for (const el of pageRefsMap.current.values()) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [pdfProxy, syncRenderedPages]);

  // Scroll spy (O(log N) binary search via viewport rects) + directional pre-render
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let rafId: number | null = null;

    const releaseLocksOnUserInput = () => {
      pendingRestorePageRef.current = null;
      programmaticScrollRef.current = false;
    };

    const detectCurrentPage = () => {
      const listEl = pagesContainerRef.current;
      if (!listEl || listEl.children.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      const focalY = containerRect.top + containerRect.height * 0.35;
      const children = listEl.children;
      let lo = 0;
      let hi = children.length - 1;
      let bestIdx = 0;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const rect = (children[mid] as HTMLElement).getBoundingClientRect();
        if (focalY < rect.top) {
          bestIdx = mid;
          hi = mid - 1;
        } else if (focalY > rect.bottom) {
          bestIdx = mid;
          lo = mid + 1;
        } else {
          bestIdx = mid;
          break;
        }
      }

      if (bestIdx > 0) {
        const currRect = (
          children[bestIdx] as HTMLElement
        ).getBoundingClientRect();
        const prevRect = (
          children[bestIdx - 1] as HTMLElement
        ).getBoundingClientRect();
        if (
          focalY < currRect.top &&
          Math.abs(prevRect.bottom - focalY) < Math.abs(currRect.top - focalY)
        ) {
          bestIdx -= 1;
        }
      } else if (bestIdx < children.length - 1) {
        const currRect = (
          children[bestIdx] as HTMLElement
        ).getBoundingClientRect();
        const nextRect = (
          children[bestIdx + 1] as HTMLElement
        ).getBoundingClientRect();
        if (
          focalY > currRect.bottom &&
          Math.abs(nextRect.top - focalY) < Math.abs(currRect.bottom - focalY)
        ) {
          bestIdx += 1;
        }
      }

      const matchedPage = bestIdx + 1;
      setCurrentPage((prev) => (prev !== matchedPage ? matchedPage : prev));
    };

    const onScroll = () => {
      const nowTop = container.scrollTop;
      const signedDelta = nowTop - lastScrollTopRef.current;
      const absDelta = Math.abs(signedDelta);
      lastScrollTopRef.current = nowTop;

      if (signedDelta > 2) scrollDirectionRef.current = 1;
      else if (signedDelta < -2) scrollDirectionRef.current = -1;

      // Only defer rendering on huge scrollbar drags (> 900px in a single event)
      if (absDelta > 900 && !programmaticScrollRef.current) {
        isJumpingScrollRef.current = true;
      }

      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
      scrollSettleTimerRef.current = setTimeout(() => {
        isJumpingScrollRef.current = false;
        if (
          !programmaticScrollRef.current &&
          pendingRestorePageRef.current === null
        ) {
          detectCurrentPage();
        }
        syncRenderedPages(
          readingStateRef.current.lastPage,
          totalPagesRef.current,
        );
      }, 75);

      if (
        programmaticScrollRef.current ||
        pendingRestorePageRef.current !== null ||
        rafId !== null
      ) {
        return;
      }

      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (
          programmaticScrollRef.current ||
          pendingRestorePageRef.current !== null
        ) {
          return;
        }
        detectCurrentPage();
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("wheel", releaseLocksOnUserInput, {
      passive: true,
    });
    container.addEventListener("pointerdown", releaseLocksOnUserInput, {
      passive: true,
    });
    container.addEventListener("touchstart", releaseLocksOnUserInput, {
      passive: true,
    });

    return () => {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("wheel", releaseLocksOnUserInput);
      container.removeEventListener("pointerdown", releaseLocksOnUserInput);
      container.removeEventListener("touchstart", releaseLocksOnUserInput);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (scrollSettleTimerRef.current) {
        clearTimeout(scrollSettleTimerRef.current);
      }
    };
  }, [syncRenderedPages, pdfSource, pdfProxy]);

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
        DocumentDatabase.saveAnnotations(docId, [
          ...annotations,
          ...cropAnnotations,
        ]),
        DocumentDatabase.saveBookmarks(docId, bookmarks),
        DocumentCatalogStorage.updateDocument(docId, {
          lastPage: currentPage,
          zoom: zoomLevel,
          pageCount: totalPages,
          annotationCount: annotations.length + cropAnnotations.length,
        }),
      ]);

      if (activeDoc.filePath) {
        await PdfService.burnAndSave(activeDoc.filePath, burnableAnnotations);
      }

      savedBookmarksRef.current = bookmarks;
      savedCropsRef.current = cropAnnotations;
      markSaved();
      clearDirty();
      toast.success("Saved");
      return true;
    } catch (err: any) {
      console.error("Failed to save PDF", err);
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
      if ((document.activeElement as HTMLElement | null)?.isContentEditable) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "s") {
          e.preventDefault();
          executeSave();
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
  }, [search, executeSave, canUndo, canRedo, undo, redo]);

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
  }, [pdfSource, pdfProxy]);

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
    },
    [currentPage, pageLabels],
  );

  const handleFitToWidth = useCallback(() => {
    if (!scrollRef.current) return;
    const avail = scrollRef.current.clientWidth - 48;
    const dim = pageDimensions[currentPage] ?? pageDimensions[1] ?? DEFAULT_DIM;
    if (dim.width > 0) {
      setZoomLevel(
        Math.min(500, Math.max(25, Math.floor((avail / dim.width) * 100))),
      );
    }
  }, [pageDimensions, currentPage]);

  const handleAddAnnotation = useCallback(
    (annot: PdfAnnotation) => {
      hasEditedAnnotationsRef.current = true;
      setAnnotations((prev) => [...prev, annot]);
    },
    [setAnnotations],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      hasEditedAnnotationsRef.current = true;
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    },
    [setAnnotations],
  );

  const handleNoteClick = useCallback(
    (note: NoteAnnotation, pos: { x: number; y: number }) => {
      setEditingNoteId(note.id);
      setNoteAnchorPos(pos);
    },
    [],
  );

  const handleAddFigureCrop = useCallback(
    async (crop: {
      pageNumber: number;
      imageUrl: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }): Promise<CropAnnotation | undefined> => {
      if (!activeDoc?.id) return undefined;
      const id = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const created: CropAnnotation = {
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
      };
      await Promise.all([
        DocumentDatabase.saveFigureCrop(id, crop.imageUrl, activeDoc.id),
        DocumentDatabase.appendAnnotation(activeDoc.id, created),
      ]);
      setCropAnnotations((prev) => {
        const next = [created, ...prev];
        savedCropsRef.current = next;
        return next;
      });
      toast.success("Figure captured");
      return created;
    },
    [activeDoc?.id],
  );

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
    },
    [jumpToPage, pdfProxy],
  );

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
        programmaticScrollRef.current = true;
        setCurrentPage(targetPage);
        setRenderedPages(
          new Set(
            [
              targetPage - 2,
              targetPage - 1,
              targetPage,
              targetPage + 1,
              targetPage + 2,
              targetPage + 3,
            ].filter((p) => p >= 1 && p <= count),
          ),
        );
        requestAnimationFrame(() => {
          const el = pageRefsMap.current.get(targetPage);
          const container = scrollRef.current;
          if (container && el) {
            const topDelta =
              el.getBoundingClientRect().top -
              container.getBoundingClientRect().top;
            container.scrollTo({
              top: Math.max(0, container.scrollTop + topDelta - 24),
              behavior: "auto",
            });
          }
          restoreTimerRef.current = setTimeout(() => {
            programmaticScrollRef.current = false;
            pendingRestorePageRef.current = null;
          }, 80);
        });
      } else {
        pendingRestorePageRef.current = null;
        setRenderedPages(
          new Set([1, 2, 3, 4].filter((p) => p >= 1 && p <= count)),
        );
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
    [activeDoc?.id, setDocPageCount],
  );

  const handleDocumentLoadError = useCallback((err: Error) => {
    toast.error(err?.message || "Failed to load PDF");
  }, []);

  if (!activeDoc || !pdfSource) return null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-deep)]">
      {/* Row 1: Full-width ViewerHeader */}
      <ViewerHeader
        currentPage={currentPage}
        totalPages={totalPages}
        currentLabel={currentLabel}
        zoomLevel={zoomLevel}
        isSidebarOpen={sidebarOpen}
        isCurrentPageBookmarked={isBookmarked}
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
      />

      {/* Row 2+: Sidebar on left, Toolbar + PDF canvas on center, AI / Summary Split on right */}
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
          }}
          onDeleteCrop={async (id) => {
            await Promise.all([
              DocumentDatabase.deleteFigureCrop(id),
              activeDoc?.id
                ? DocumentDatabase.removeAnnotation(activeDoc.id, id)
                : Promise.resolve(),
            ]);
            setCropAnnotations((prev) => {
              const next = prev.filter((c) => c.id !== id);
              savedCropsRef.current = next;
              return next;
            });
          }}
        />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
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
                onLoadSuccess={handleDocumentLoadSuccess}
                onLoadError={handleDocumentLoadError}
                loading={null}
              >
                <div
                  ref={pagesContainerRef}
                  className="mx-auto flex flex-col items-center gap-6"
                >
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (pageNum) => {
                      const dim =
                        pageDimensions[pageNum] ??
                        pageDimensions[1] ??
                        DEFAULT_DIM;
                      const w = Math.round((dim.width * zoomLevel) / 100);
                      const h = Math.round((dim.height * zoomLevel) / 100);

                      return (
                        <div
                          key={pageNum}
                          ref={getPageRefCallback(pageNum)}
                          data-page-number={pageNum}
                        >
                          {renderedPages.has(pageNum) ? (
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
                              registerPageRef={noopRegisterPageRef}
                              onAddAnnotation={handleAddAnnotation}
                              onDeleteAnnotation={handleDeleteAnnotation}
                              onNoteClick={handleNoteClick}
                              onAddFigureCrop={handleAddFigureCrop}
                              onDimensionsDiscovered={
                                handleDimensionsDiscovered
                              }
                            />
                          ) : (
                            <div
                              style={{ width: w, height: h }}
                              aria-hidden="true"
                              className="rounded-sm border border-border bg-white shadow-[var(--shadow-sm)]"
                            />
                          )}
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
        </div>

        {/* Resizable Right AI Studio / Living Summary Split Pane */}
        <AiStudioSidebar
          isOpen={isAiStudioOpen}
          onJumpToPage={jumpToPage}
          annotations={studioAnnotations}
        />
      </div>

      <NoteEditorPortal
        note={editingNote}
        anchorPos={noteAnchorPos}
        onClose={() => {
          setEditingNoteId(null);
          setNoteAnchorPos(null);
        }}
        onUpdateNote={(updated) => {
          hasEditedAnnotationsRef.current = true;
          setAnnotations((prev) =>
            prev.map((a) => (a.id === updated.id ? updated : a)),
          );
        }}
        onDeleteNote={(id) => {
          hasEditedAnnotationsRef.current = true;
          setAnnotations((prev) => prev.filter((a) => a.id !== id));
          setEditingNoteId(null);
          setNoteAnchorPos(null);
        }}
      />
    </div>
  );
}

export default ViewerView;
