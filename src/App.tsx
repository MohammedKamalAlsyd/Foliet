import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { LibraryView } from "@/pages/LibraryView";
import { Titlebar } from "@/components/Titlebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { PdfService } from "@/services/pdf";
import { BinaryStorage } from "@/services/storage/binary";
import {
  DocumentCatalogStorage,
  deduplicateDocuments,
  normalizePath,
} from "@/services/storage/catalog";
import { WindowService } from "@/services/window";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { CatalogItem } from "@/types/catalog";
import type { DocumentItem, PdfOpenResult } from "@/types/document";

type UnsavedAction = "close_window" | "navigate_home" | null;

const stripByIdentity = (
  list: CatalogItem[],
  id: string,
  filePath?: string,
) => {
  const norm = normalizePath(filePath);
  return list.filter(
    (d) => d.id !== id && (!norm || normalizePath(d.filePath) !== norm),
  );
};

export function App() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const isViewerOpen = useDocumentStore((s) => s.isViewerOpen);
  const isSaving = useDocumentStore((s) => s.isSaving);
  const openDocument = useDocumentStore((s) => s.openDocument);
  const setExtractedAnnotations = useDocumentStore(
    (s) => s.setExtractedAnnotations,
  );
  const closeDocument = useDocumentStore((s) => s.closeDocument);
  const saveDocument = useDocumentStore((s) => s.saveDocument);

  const isDark = useSystemStore((s) => s.isDark);
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);

  const [documents, setDocuments] = useState<CatalogItem[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [forgetAllOpen, setForgetAllOpen] = useState(false);
  const [unsavedAction, setUnsavedAction] = useState<UnsavedAction>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    WindowService.onCloseRequested((event) => {
      if (useDocumentStore.getState().isDirty) {
        event.preventDefault();
        setUnsavedAction("close_window");
      }
    }).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    DocumentCatalogStorage.getDocuments()
      .then((docs) => active && setDocuments(deduplicateDocuments(docs)))
      .catch(() => toast.error("Failed to load library catalog"))
      .finally(() => active && setCatalogLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (catalogLoaded) {
      DocumentCatalogStorage.saveDocuments(documents);
    }
  }, [documents, catalogLoaded]);

  /** Opens metadata immediately, renders viewer, and hydrates embedded annotations in background. */
  const activatePdf = useCallback(
    async (result: PdfOpenResult, existing?: CatalogItem) => {
      const now = Date.now();
      const title =
        existing?.title ||
        result.fileName.replace(/\.pdf$/i, "") ||
        "Untitled document";

      const catalogEntry: CatalogItem = {
        id: result.docId,
        title,
        fileName: result.fileName,
        filePath: result.filePath,
        fileSize: result.fileSize,
        pageCount: result.numPages,
        lastPage: existing?.lastPage ?? 1,
        scrollOffset: existing?.scrollOffset ?? 0,
        zoom: existing?.zoom ?? 100,
        authors: existing?.authors,
        year: existing?.year,
        collection: existing?.collection,
        addedAt: existing?.addedAt ?? now,
        lastOpenedAt: now,
        isIndexed: existing?.isIndexed,
        annotationCount: existing?.annotationCount,
      };

      setDocuments((prev) => [
        catalogEntry,
        ...stripByIdentity(prev, result.docId, result.filePath),
      ]);

      const runtimeDoc: DocumentItem = {
        id: result.docId,
        title,
        pages: result.numPages,
        filePath: result.filePath,
        lastPage: catalogEntry.lastPage,
        scrollOffset: catalogEntry.scrollOffset,
        zoom: catalogEntry.zoom,
        extractedAnnotations: result.extractedAnnotations,
      };

      // Instant open: zero buffer copy; viewer streams via convertFileSrc(filePath)
      openDocument(runtimeDoc, null);

      // Non-blocking background annotation scan if not returned eagerly
      if (!result.extractedAnnotations) {
        PdfService.extractAnnotations(result.filePath)
          .then((annots) => {
            if (annots && annots.length > 0) {
              setExtractedAnnotations(result.docId, annots);
            }
          })
          .catch(() => {});
      }
    },
    [openDocument, setExtractedAnnotations],
  );

  const handleOpenCatalogDoc = async (doc: CatalogItem) => {
    if (useDocumentStore.getState().isDirty) {
      setUnsavedAction("navigate_home");
      return;
    }
    if (!doc.filePath) {
      toast.error(`Missing file path for "${doc.title}"`);
      return;
    }
    try {
      const result = await PdfService.openDocument(doc.filePath);
      await activatePdf(result, doc);
    } catch (err: any) {
      toast.error(err?.message || `Cannot open "${doc.title}"`);
    }
  };

  const handleImportPath = useCallback(
    async (filePath: string) => {
      if (useDocumentStore.getState().isDirty) {
        setUnsavedAction("navigate_home");
        return;
      }
      try {
        const result = await PdfService.openDocument(filePath);
        const existing = documents.find(
          (d) =>
            d.id === result.docId ||
            normalizePath(d.filePath) === normalizePath(result.filePath),
        );
        await activatePdf(result, existing);
      } catch (err: any) {
        toast.error(err?.message || "Failed to open PDF");
      }
    },
    [activatePdf, documents],
  );

  const handleForgetDoc = async (docId: string) => {
    try {
      if (activeDoc?.id === docId) closeDocument();
      const annots = await BinaryStorage.getAnnotations(docId);
      await Promise.all(
        annots
          .filter((a) => a.toolType === "area_select")
          .map((a) => BinaryStorage.deleteFigureCrop(a.id)),
      );
      await DocumentCatalogStorage.removeDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch {
      toast.error("Failed to remove document records");
    }
  };

  const handleForgetAll = async () => {
    try {
      closeDocument();
      await DocumentCatalogStorage.clearAll();
      setDocuments([]);
      setForgetAllOpen(false);
    } catch {
      toast.error("Failed to clear library");
    }
  };

  const completeUnsavedAction = async (saveFirst: boolean) => {
    if (saveFirst && !(await saveDocument())) return;
    const action = unsavedAction;
    setUnsavedAction(null);
    if (action === "close_window") await WindowService.forceDestroy();
    else if (action === "navigate_home") closeDocument();
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <Titlebar
        onRequestClose={() => WindowService.close()}
        onNavigateHome={() =>
          useDocumentStore.getState().isDirty
            ? setUnsavedAction("navigate_home")
            : closeDocument()
        }
      />

      {!isViewerOpen ? (
        <LibraryView
          documents={documents}
          onOpenDoc={handleOpenCatalogDoc}
          onImportPath={handleImportPath}
          onForgetDoc={handleForgetDoc}
          onRequestForgetAll={() => setForgetAllOpen(true)}
        />
      ) : (
        /* Part 2 will mount <ViewerView /> here */
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Viewer ready for {activeDoc?.title} ({activeDoc?.pages} pages)
        </main>
      )}

      {/* Clear Library Dialog */}
      <AlertDialog open={forgetAllOpen} onOpenChange={setForgetAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear library</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {documents.length} document
              {documents.length === 1 ? "" : "s"} from Foliet along with local
              annotations and bookmarks. Original PDF files on disk remain
              untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForgetAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear library
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog
        open={unsavedAction !== null}
        onOpenChange={(open) => !open && setUnsavedAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved edits</AlertDialogTitle>
            <AlertDialogDescription>
              Save annotations in {activeDoc?.title || "this document"} before{" "}
              {unsavedAction === "close_window" ? "closing" : "leaving"}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={isSaving}>
              Keep reading
            </AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => completeUnsavedAction(false)}
              className="text-destructive hover:text-destructive"
            >
              Discard
            </Button>
            <AlertDialogAction
              disabled={isSaving}
              onClick={() => completeUnsavedAction(true)}
            >
              {isSaving ? "Saving" : `Save (${shortcutModifier}S)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster theme={isDark ? "dark" : "light"} position="bottom-center" />
    </div>
  );
}

export default App;
