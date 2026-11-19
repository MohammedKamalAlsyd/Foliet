import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, PanelLeft, Plus, Search, Trash2 } from "lucide-react";
import { tinykeys } from "tinykeys";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import {
  DocumentTable,
  formatBytes,
} from "@/components/libraryview/DocumentTable";
import {
  LibrarySidebar,
  type NavFilter,
} from "@/components/libraryview/LibrarySidebar";
import { useLibraryCatalog } from "@/hooks/useLibraryCatalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSystemStore } from "@/stores/systemStore";

export function LibraryView() {
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);

  const [nav, setNav] = useState<NavFilter>("all");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [pendingDeleteCollection, setPendingDeleteCollection] = useState<
    string | null
  >(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const {
    documents,
    collections,
    isClearing,
    openPdfPath,
    openCatalogDoc,
    importPdf,
    forgetDoc,
    clearAll,
    createCollection,
    renameCollection,
    deleteCollection,
    setDocCollection,
  } = useLibraryCatalog(selectedCollection);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === "enter" || type === "over") {
          setIsDragging(true);
        } else if (type === "drop") {
          setIsDragging(false);
          const pdfPath = event.payload.paths?.find((p) =>
            p.toLowerCase().endsWith(".pdf"),
          );
          if (pdfPath) openPdfPath(pdfPath);
          else toast.error("Only PDF files can be opened");
        } else {
          setIsDragging(false);
        }
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {});

    return () => {
      active = false;
      unlisten?.();
    };
  }, [openPdfPath]);

  useEffect(() => {
    return tinykeys(window, {
      "$mod+f": (e) => {
        e.preventDefault();
        searchRef.current?.focus();
      },
      "$mod+F": (e) => {
        e.preventDefault();
        searchRef.current?.focus();
      },
    });
  }, []);

  const counts = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      all: documents.length,
      recent: documents.filter((d) => d.lastOpenedAt >= weekAgo).length,
      annotated: documents.filter((d) => (d.annotationCount ?? 0) > 0).length,
    };
  }, [documents]);

  const collectionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const doc of documents) {
      if (doc.collection) map[doc.collection] = (map[doc.collection] ?? 0) + 1;
    }
    return map;
  }, [documents]);

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const weekAgo = Date.now() - 7 * 86_400_000;

    return [...documents]
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
      .filter((doc) => {
        if (nav === "recent" && doc.lastOpenedAt < weekAgo) return false;
        if (nav === "annotated" && (doc.annotationCount ?? 0) === 0)
          return false;
        if (selectedCollection && doc.collection !== selectedCollection)
          return false;
        if (!q) return true;
        return (
          doc.title.toLowerCase().includes(q) ||
          doc.fileName.toLowerCase().includes(q) ||
          doc.authors?.toLowerCase().includes(q) ||
          doc.collection?.toLowerCase().includes(q)
        );
      });
  }, [documents, nav, selectedCollection, query]);

  const totalSize = useMemo(
    () => documents.reduce((sum, d) => sum + (d.fileSize || 0), 0),
    [documents],
  );

  return (
    <div
      className="relative flex min-h-0 flex-1"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-4 z-40 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[var(--accent-brand)] bg-[var(--selection-bg)]">
          <FolderOpen
            size={16}
            strokeWidth={1.5}
            className="text-[var(--accent-brand)]"
          />
          <p className="text-sm font-medium text-foreground">
            Drop PDF to open
          </p>
        </div>
      )}

      {sidebarOpen && (
        <LibrarySidebar
          nav={nav}
          selectedCollection={selectedCollection}
          counts={counts}
          collections={collections}
          collectionCounts={collectionCounts}
          documentCount={documents.length}
          storageSummary={`${documents.length} · ${formatBytes(totalSize)}`}
          onSelectNav={setNav}
          onSelectCollection={setSelectedCollection}
          onCreateCollection={createCollection}
          onRenameCollection={renameCollection}
          onRequestDeleteCollection={(name) => {
            if ((collectionCounts[name] ?? 0) === 0) {
              deleteCollection(name);
              if (selectedCollection === name) setSelectedCollection(null);
            } else {
              setPendingDeleteCollection(name);
            }
          }}
          onRequestClearAll={() => setClearOpen(true)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen((p) => !p)}
                aria-label="Toggle sidebar"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
              >
                <PanelLeft size={16} strokeWidth={1.5} />
              </Button>
              <div>
                <h1 className="text-[28px] font-medium leading-[1.15] tracking-tight text-foreground">
                  {selectedCollection ?? "Library"}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedCollection
                    ? "Collection"
                    : "Stored locally on this device"}
                </p>
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={importPdf}
              className="h-8 gap-2 px-3"
            >
              <Plus size={16} strokeWidth={1.5} />
              <span>Import PDF</span>
            </Button>
          </div>

          <div className="relative flex items-center">
            <Search
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search papers"
              className="h-9 pl-9 pr-14"
            />
            <kbd className="pointer-events-none absolute right-3 hidden sm:inline-flex">
              {shortcutModifier}+F
            </kbd>
          </div>

          <DocumentTable
            documents={filteredDocs}
            totalCount={documents.length}
            collections={collections}
            onOpenDoc={openCatalogDoc}
            onForgetDoc={forgetDoc}
            onSetDocCollection={setDocCollection}
          />
        </div>
      </main>

      <ConfirmModal
        open={clearOpen}
        onOpenChange={setClearOpen}
        icon={Trash2}
        destructive
        isPending={isClearing}
        title="Clear library"
        description="Removes all papers and collections from Foliet along with local annotations and bookmarks. Original PDF files on disk remain untouched."
        meta={`${documents.length} paper${documents.length === 1 ? "" : "s"} · ${formatBytes(totalSize)}`}
        confirmLabel="Clear library"
        onConfirm={async () => {
          if (await clearAll()) {
            setSelectedCollection(null);
            setClearOpen(false);
          }
        }}
      />

      <ConfirmModal
        open={pendingDeleteCollection !== null}
        onOpenChange={(open) => !open && setPendingDeleteCollection(null)}
        icon={Trash2}
        destructive
        title="Delete collection"
        description="Removes this collection label. Papers inside remain in All papers."
        meta={
          pendingDeleteCollection
            ? `${pendingDeleteCollection} · ${collectionCounts[pendingDeleteCollection] ?? 0} papers`
            : undefined
        }
        confirmLabel="Delete collection"
        onConfirm={async () => {
          if (!pendingDeleteCollection) return;
          const target = pendingDeleteCollection;
          await deleteCollection(target);
          if (selectedCollection === target) setSelectedCollection(null);
          setPendingDeleteCollection(null);
        }}
      />
    </div>
  );
}
