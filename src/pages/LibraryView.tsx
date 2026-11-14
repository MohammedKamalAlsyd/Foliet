import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Highlighter,
  PanelLeft,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { toast } from "sonner";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { FullLogo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { PdfService } from "@/services/pdf";
import { BinaryStorage } from "@/services/storage/binary";
import {
  DocumentCatalogStorage,
  deduplicateDocuments,
  normalizePath,
} from "@/services/storage/catalog";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";
import type { CatalogItem } from "@/types/catalog";
import type { DocumentItem } from "@/types/document";

type NavFilter = "all" | "recent" | "annotated";

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

const formatOpenedAt = (ts: number) => {
  const diffDays = Math.floor((Date.now() - ts) / 86_400_000);
  const time = new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

const formatBytes = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function LibraryView() {
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);
  const openDocument = useDocumentStore((s) => s.openDocument);
  const setExtractedAnnotations = useDocumentStore(
    (s) => s.setExtractedAnnotations,
  );

  const [documents, setDocuments] = useState<CatalogItem[]>([]);
  const [nav, setNav] = useState<NavFilter>("all");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const documentsRef = useRef<CatalogItem[]>([]);
  documentsRef.current = documents;

  useEffect(() => {
    let active = true;
    DocumentCatalogStorage.getDocuments()
      .then((docs) => active && setDocuments(deduplicateDocuments(docs)))
      .catch(() => toast.error("Failed to load library catalog"));
    return () => {
      active = false;
    };
  }, []);

  const openPdfPath = useCallback(
    async (filePath: string, existingDoc?: CatalogItem) => {
      try {
        const result = await PdfService.openDocument(filePath);
        const existing =
          existingDoc ??
          documentsRef.current.find(
            (d) =>
              d.id === result.docId ||
              normalizePath(d.filePath) === normalizePath(result.filePath),
          );

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

        const next = [
          catalogEntry,
          ...stripByIdentity(
            documentsRef.current,
            result.docId,
            result.filePath,
          ),
        ];
        setDocuments(next);
        DocumentCatalogStorage.saveDocuments(next).catch(() => {});

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

        openDocument(runtimeDoc, null);

        if (!result.extractedAnnotations) {
          PdfService.extractAnnotations(result.filePath)
            .then((annots) => {
              if (annots && annots.length > 0) {
                setExtractedAnnotations(result.docId, annots);
              }
            })
            .catch(() => {});
        }
      } catch (err: any) {
        toast.error(err?.message || "Failed to open PDF");
      }
    },
    [openDocument, setExtractedAnnotations],
  );

  const handleOpenCatalogDoc = (doc: CatalogItem) => {
    if (!doc.filePath) {
      toast.error(`Missing file path for "${doc.title}"`);
      return;
    }
    openPdfPath(doc.filePath, doc);
  };

  const handleImportClick = async () => {
    try {
      const result = await PdfService.pickFile();
      if (result) await openPdfPath(result.filePath);
    } catch (err: any) {
      toast.error(err?.message || "Could not open file");
    }
  };

  const handleForgetDoc = async (docId: string) => {
    try {
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
    setIsClearing(true);
    try {
      await DocumentCatalogStorage.clearAll();
      setDocuments([]);
      setClearOpen(false);
    } catch {
      toast.error("Failed to clear library");
    } finally {
      setIsClearing(false);
    }
  };

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
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const collections = useMemo(
    () =>
      Array.from(
        new Set(
          documents
            .map((d) => d.collection)
            .filter((c): c is string => Boolean(c)),
        ),
      ).sort(),
    [documents],
  );

  const counts = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    return {
      all: documents.length,
      recent: documents.filter((d) => d.lastOpenedAt >= weekAgo).length,
      annotated: documents.filter((d) => (d.annotationCount ?? 0) > 0).length,
    };
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

  const navItems: {
    id: NavFilter;
    label: string;
    icon: typeof BookOpen;
    count: number;
  }[] = [
    { id: "all", label: "All papers", icon: BookOpen, count: counts.all },
    { id: "recent", label: "Recent", icon: Clock, count: counts.recent },
    {
      id: "annotated",
      label: "Annotated",
      icon: Highlighter,
      count: counts.annotated,
    },
  ];

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
        <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-border bg-muted/30 p-4">
          <div className="flex flex-col gap-6">
            <FullLogo size="sm" subtitle="Research library" />

            <nav aria-label="Library sections" className="flex flex-col gap-1">
              {navItems.map(({ id, label, icon: Icon, count }) => {
                const active = nav === id && !selectedCollection;
                return (
                  <Button
                    key={id}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setNav(id);
                      setSelectedCollection(null);
                    }}
                    className={cn(
                      "h-8 w-full justify-between px-3 text-sm",
                      active
                        ? "bg-accent font-medium text-accent-foreground"
                        : "font-normal text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Icon size={16} strokeWidth={1.5} />
                      <span>{label}</span>
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </Button>
                );
              })}
            </nav>

            {collections.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="px-3 text-xs font-medium text-muted-foreground">
                  Collections
                </span>
                <div className="flex flex-col gap-1">
                  {collections.map((name) => {
                    const active = selectedCollection === name;
                    return (
                      <Button
                        key={name}
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setSelectedCollection(active ? null : name)
                        }
                        className={cn(
                          "h-8 w-full justify-start gap-2 px-3 text-sm",
                          active
                            ? "bg-accent font-medium text-accent-foreground"
                            : "font-normal text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <FolderOpen size={16} strokeWidth={1.5} />
                        <span className="truncate">{name}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <Separator />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Local storage</span>
              <span className="font-mono tabular-nums">
                {documents.length} · {formatBytes(totalSize)}
              </span>
            </div>
            {documents.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setClearOpen(true)}
                className="h-8 justify-start gap-2 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={16} strokeWidth={1.5} />
                <span>Clear library</span>
              </Button>
            )}
          </div>
        </aside>
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
                  Stored locally on this device
                </p>
              </div>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={handleImportClick}
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
              {shortcutModifier}K
            </kbd>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="grid grid-cols-[1fr_80px_96px_120px] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
              <span>Document</span>
              <span className="text-right">Pages</span>
              <span className="text-right">Notes</span>
              <span className="text-right">Opened</span>
            </div>

            <div className="divide-y divide-border">
              {filteredDocs.map((doc) => (
                <ContextMenu key={doc.id}>
                  <ContextMenuTrigger>
                    <button
                      type="button"
                      onClick={() => handleOpenCatalogDoc(doc)}
                      className="grid w-full grid-cols-[1fr_80px_96px_120px] items-center gap-4 px-4 py-3 text-left transition-colors duration-150 ease-[var(--ease-foliet)] hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText
                          size={16}
                          strokeWidth={1.5}
                          className="mt-0.5 shrink-0 text-muted-foreground"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {doc.title}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {doc.authors
                              ? `${doc.authors}${doc.year ? ` · ${doc.year}` : ""}`
                              : `${doc.fileName} · ${formatBytes(doc.fileSize)}`}
                          </div>
                        </div>
                      </div>

                      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {doc.pageCount}
                      </span>
                      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {doc.annotationCount ?? 0}
                      </span>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {formatOpenedAt(doc.lastOpenedAt)}
                      </span>
                    </button>
                  </ContextMenuTrigger>

                  <ContextMenuContent className="w-48">
                    <ContextMenuItem onClick={() => handleOpenCatalogDoc(doc)}>
                      <BookOpen size={16} strokeWidth={1.5} />
                      Open
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={async () => {
                        if (!(await PdfService.revealInFolder(doc.filePath))) {
                          toast.error("File location unavailable");
                        }
                      }}
                    >
                      <ExternalLink size={16} strokeWidth={1.5} />
                      Reveal in folder
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={async () => {
                        await navigator.clipboard.writeText(doc.title);
                        toast.success("Title copied");
                      }}
                    >
                      <Copy size={16} strokeWidth={1.5} />
                      Copy title
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => handleForgetDoc(doc.id)}
                    >
                      <Trash2 size={16} strokeWidth={1.5} />
                      Remove from library
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}

              {filteredDocs.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {documents.length === 0
                      ? "No papers yet"
                      : "No matching documents"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {documents.length === 0
                      ? "Import a PDF or drop one anywhere in this window"
                      : "Try clearing your search or collection filter"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <ConfirmModal
        open={clearOpen}
        onOpenChange={setClearOpen}
        icon={Trash2}
        destructive
        isPending={isClearing}
        title="Clear library"
        description="Removes all papers from Foliet along with local annotations and bookmarks. Original PDF files on disk remain untouched."
        meta={`${documents.length} paper${documents.length === 1 ? "" : "s"} · ${formatBytes(totalSize)}`}
        confirmLabel="Clear library"
        onConfirm={handleForgetAll}
      />
    </div>
  );
}
