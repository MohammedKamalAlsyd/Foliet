import { useEffect, useState } from "react";
import {
  BookOpen,
  Clock,
  FileText,
  FolderOpen,
  Highlighter,
  MessageSquare,
  PanelLeft,
  Plus,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { FullLogo } from "@/components/Logo";
import { Titlebar } from "@/components/Titlebar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";

interface LibraryDocument {
  id: string;
  title: string;
  authors: string;
  year: number;
  pages: number;
  annotations: number;
  lastOpened: string;
  collection: string;
}

const SAMPLE_DOCS: LibraryDocument[] = [
  {
    id: "doc-1",
    title: "Local-First Software: You Own Your Data, in spite of the Cloud",
    authors: "Kleppmann, Wiggins, van Hardenberg, McGranaghan",
    year: 2019,
    pages: 18,
    annotations: 14,
    lastOpened: "Today, 14:20",
    collection: "Systems",
  },
  {
    id: "doc-2",
    title: "Typography and Reading Comprehension on High-DPI Displays",
    authors: "Larson, Picard",
    year: 2022,
    pages: 24,
    annotations: 7,
    lastOpened: "Yesterday",
    collection: "Reading UX",
  },
  {
    id: "doc-3",
    title: "Retrieval-Augmented Marginalia for Long-Context Research",
    authors: "Chen, Alvarez",
    year: 2025,
    pages: 31,
    annotations: 22,
    lastOpened: "Nov 10",
    collection: "Retrieval",
  },
  {
    id: "doc-4",
    title: "Incremental PDF Binary Serialization in Desktop Readers",
    authors: "Sato",
    year: 2024,
    pages: 12,
    annotations: 3,
    lastOpened: "Nov 4",
    collection: "Systems",
  },
];

const NAV_ITEMS = [
  { id: "all", label: "All papers", icon: BookOpen, count: 4 },
  { id: "recent", label: "Recent", icon: Clock, count: 2 },
  { id: "annotated", label: "Annotated", icon: Highlighter, count: 4 },
] as const;

export function App() {
  const isDark = useSystemStore((state) => state.isDark);
  const shortcutModifier = useSystemStore((state) => state.shortcutModifier);

  const isViewerOpen = useDocumentStore((state) => state.isViewerOpen);
  const activeDoc = useDocumentStore((state) => state.activeDoc);
  const isDirty = useDocumentStore((state) => state.isDirty);
  const openDocument = useDocumentStore((state) => state.openDocument);
  const closeDocument = useDocumentStore((state) => state.closeDocument);

  const [activeNav, setActiveNav] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [activePage, setActivePage] = useState(4);

  // Keep shadcn's .dark class synced with systemStore
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  const filteredDocs = SAMPLE_DOCS.filter((doc) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.authors.toLowerCase().includes(q) ||
      doc.collection.toLowerCase().includes(q)
    );
  });

  const handleOpenDoc = (doc: LibraryDocument) => {
    openDocument?.({
      id: doc.id,
      title: doc.title,
      path: `${doc.id}.pdf`,
    } as never);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <Titlebar onNavigateHome={() => closeDocument?.()} />

      <div className="flex min-h-0 flex-1">
        {/* Library Sidebar */}
        {!isViewerOpen && sidebarOpen && (
          <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-border bg-muted/30 p-4">
            <div className="flex flex-col gap-6">
              <FullLogo size="sm" subtitle="Research library" />

              <nav
                aria-label="Library sections"
                className="flex flex-col gap-1"
              >
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = activeNav === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveNav(item.id)}
                      className={cn(
                        "flex h-9 w-full items-center justify-between rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-accent font-medium text-accent-foreground"
                          : "font-normal text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Icon size={16} strokeWidth={1.5} />
                        <span>{item.label}</span>
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {item.count}
                      </span>
                    </button>
                  );
                })}
              </nav>

              <div className="flex flex-col gap-2">
                <span className="px-3 text-xs font-medium text-muted-foreground">
                  Collections
                </span>
                <div className="flex flex-col gap-1">
                  {["Systems", "Reading UX", "Retrieval"].map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="flex h-8 w-full items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <FolderOpen size={16} strokeWidth={1.5} />
                      <span className="truncate">{name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Local storage</span>
                <span className="font-mono tabular-nums">4 files</span>
              </div>
            </div>
          </aside>
        )}

        {/* Main Workspace */}
        {!isViewerOpen ? (
          <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
              {/* Header row */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSidebarOpen((prev) => !prev)}
                    aria-label="Toggle sidebar"
                    className="h-9 w-9 text-muted-foreground hover:text-foreground"
                  >
                    <PanelLeft size={16} strokeWidth={1.5} />
                  </Button>
                  <div>
                    <h1 className="text-2xl font-medium tracking-tight text-foreground">
                      Library
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      Stored locally on this device
                    </p>
                  </div>
                </div>

                <Button type="button" size="sm" className="h-9 gap-2 px-4">
                  <Plus size={16} strokeWidth={1.5} />
                  <span>Import PDF</span>
                </Button>
              </div>

              {/* Search bar */}
              <div className="relative flex items-center">
                <Search
                  size={16}
                  strokeWidth={1.5}
                  className="pointer-events-none absolute left-3 text-muted-foreground"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search papers, authors, or collections"
                  className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <kbd className="pointer-events-none absolute right-3 hidden h-5 items-center rounded border border-border bg-muted px-1 font-mono text-xs text-muted-foreground sm:inline-flex">
                  {shortcutModifier}K
                </kbd>
              </div>

              {/* Document table */}
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="grid grid-cols-[1fr_80px_96px_120px] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span>Document</span>
                  <span className="text-right">Pages</span>
                  <span className="text-right">Notes</span>
                  <span className="text-right">Opened</span>
                </div>

                <div className="divide-y divide-border">
                  {filteredDocs.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => handleOpenDoc(doc)}
                      className="grid w-full grid-cols-[1fr_80px_96px_120px] items-center gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText
                          size={16}
                          strokeWidth={1.5}
                          className="mt-1 shrink-0 text-muted-foreground"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {doc.title}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {doc.authors} · {doc.year}
                          </div>
                        </div>
                      </div>

                      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {doc.pages}
                      </span>
                      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {doc.annotations}
                      </span>
                      <span className="text-right text-xs tabular-nums text-muted-foreground">
                        {doc.lastOpened}
                      </span>
                    </button>
                  ))}

                  {filteredDocs.length === 0 && (
                    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                      No matching documents
                    </div>
                  )}
                </div>
              </div>
            </div>
          </main>
        ) : (
          /* Reader View */
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Reader Sub-toolbar */}
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted/20 px-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">
                  Page {activePage} of 18
                </span>
                <span>·</span>
                <span>{isDirty ? "Edited" : "Synced"}</span>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setZoom((z) => Math.max(75, z - 10))}
                  aria-label="Zoom out"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <ZoomOut size={16} strokeWidth={1.5} />
                </Button>
                <span className="w-12 text-center font-mono text-xs tabular-nums text-foreground">
                  {zoom}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setZoom((z) => Math.min(150, z + 10))}
                  aria-label="Zoom in"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                >
                  <ZoomIn size={16} strokeWidth={1.5} />
                </Button>
              </div>
            </div>

            {/* Canvas + Marginalia Panel */}
            <div className="flex min-h-0 flex-1">
              <div className="flex-1 overflow-y-auto bg-muted/40 p-8">
                {/* Document Page Moment */}
                <article
                  className="mx-auto max-w-2xl rounded-lg border border-border bg-card p-12 shadow-sm"
                  style={{ zoom: `${zoom}%` }}
                >
                  <header className="mb-8 border-b border-border pb-6">
                    <p className="mb-2 font-mono text-xs text-muted-foreground">
                      Section 2 · Architecture
                    </p>
                    <h2 className="text-xl font-medium tracking-tight text-foreground">
                      {activeDoc?.title || "Document preview"}
                    </h2>
                  </header>

                  <div className="flex flex-col gap-4 text-sm leading-relaxed text-foreground/90">
                    <p>
                      Desktop research tools spend hours in front of dense
                      typographic material. Keeping application chrome neutral
                      lets the document surface carry visual emphasis without
                      competing borders or ambient glows.
                    </p>
                    <p>
                      <mark className="rounded bg-amber-200/60 px-1 text-foreground dark:bg-amber-500/25">
                        Annotations remain bound directly to local file offsets
                        so exports stay portable across machines without a
                        central server.
                      </mark>
                    </p>
                    <p>
                      Page-level state, reading position, and highlights commit
                      atomically when saved with{" "}
                      <kbd className="inline-flex h-5 items-center rounded border border-border bg-muted px-1 font-mono text-xs text-muted-foreground">
                        {shortcutModifier}S
                      </kbd>
                      .
                    </p>
                  </div>

                  <footer className="mt-12 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                    <span>foliet reader</span>
                    <button
                      type="button"
                      onClick={() =>
                        setActivePage((p) => (p >= 18 ? 1 : p + 1))
                      }
                      className="font-mono tabular-nums hover:text-foreground"
                    >
                      {activePage} / 18
                    </button>
                  </footer>
                </article>
              </div>

              {/* Marginalia Sidebar */}
              <aside className="hidden w-72 shrink-0 flex-col border-l border-border bg-background p-4 lg:flex">
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <MessageSquare size={16} strokeWidth={1.5} />
                    <span>Marginalia</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    1 note
                  </span>
                </div>

                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between font-mono text-xs text-muted-foreground">
                    <span>Page {activePage}</span>
                    <span>Highlight</span>
                  </div>
                  <p className="text-xs leading-relaxed text-foreground">
                    Verify offset stability after incremental binary writes.
                  </p>
                </div>
              </aside>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

export default App;
