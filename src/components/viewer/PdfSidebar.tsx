import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  ListTree,
  Plus,
  Scan,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { DocumentDatabase } from "@/services/storage/database";
import type { CropAnnotation } from "@/types/annotations";
import type { BookmarkItem, PdfOutlineNode } from "@/types/document";

interface PdfSidebarProps {
  isOpen: boolean;
  outline: PdfOutlineNode[];
  bookmarks: BookmarkItem[];
  crops: CropAnnotation[];
  currentPage: number;
  pageLabels: string[];
  onJumpToPage: (page: number) => void;
  onAddBookmark: (page: number) => void;
  onDeleteBookmark: (id: string) => void;
  onDeleteCrop: (id: string) => void;
}

function OutlineItem({
  node,
  activeId,
  activeParentIds,
  onJumpToPage,
}: {
  node: PdfOutlineNode;
  activeId: string | null;
  activeParentIds: Set<string>;
  onJumpToPage: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(node.level < 1);
  const rowRef = useRef<HTMLDivElement>(null);
  const hasChildren = Boolean(node.children?.length);
  const isActive = node.id === activeId;
  const isActiveAncestor = activeParentIds.has(node.id);

  useEffect(() => {
    if (isActiveAncestor) setExpanded(true);
  }, [isActiveAncestor]);

  useEffect(() => {
    if (isActive) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isActive]);

  return (
    <div>
      <div
        ref={rowRef}
        className={cn(
          "relative flex min-h-8 items-center gap-1.5 rounded-md py-1 pr-2.5 pl-1.5 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
          isActive
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        {isActive && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-[var(--accent-brand)]"
          />
        )}

        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            aria-label={expanded ? "Collapse section" : "Expand section"}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown size={16} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={16} strokeWidth={1.5} />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onJumpToPage(node.pageNumber)}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-left"
        >
          <span className="truncate">{node.title}</span>
          <span
            className={cn(
              "shrink-0 font-mono text-[11px] tabular-nums",
              isActive ? "text-foreground" : "text-muted-foreground/80",
            )}
          >
            {node.pageNumber}
          </span>
        </button>
      </div>

      {hasChildren && expanded && (
        <div className="mt-0.5 ml-3.5 flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
          {node.children!.map((child) => (
            <OutlineItem
              key={child.id}
              node={child}
              activeId={activeId}
              activeParentIds={activeParentIds}
              onJumpToPage={onJumpToPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CropThumbnail({ crop }: { crop: CropAnnotation }) {
  const [src, setSrc] = useState<string | null>(
    crop.imageUrl.startsWith("data:") ? crop.imageUrl : null,
  );

  useEffect(() => {
    let active = true;
    if (crop.imageUrl.startsWith("idb://")) {
      DocumentDatabase.getFigureCrop(crop.id).then((data) => {
        if (active && data) setSrc(data);
      });
    }
    return () => {
      active = false;
    };
  }, [crop.id, crop.imageUrl]);

  if (!src) {
    return (
      <div className="flex h-24 w-full items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
        Loading
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={crop.caption || `Figure from page ${crop.pageNumber}`}
      className="max-h-48 w-full rounded-md border border-border bg-background object-contain"
    />
  );
}

export function PdfSidebar({
  isOpen,
  outline,
  bookmarks,
  crops,
  currentPage,
  pageLabels,
  onJumpToPage,
  onAddBookmark,
  onDeleteBookmark,
  onDeleteCrop,
}: PdfSidebarProps) {
  const flatOutline = useMemo(() => {
    const items: { id: string; pageNumber: number; parentIds: string[] }[] = [];
    const walk = (nodes: PdfOutlineNode[], parentIds: string[]) => {
      for (const n of nodes) {
        items.push({ id: n.id, pageNumber: n.pageNumber, parentIds });
        if (n.children?.length) walk(n.children, [...parentIds, n.id]);
      }
    };
    walk(outline, []);
    return items;
  }, [outline]);

  const { activeOutlineId, activeParentIds } = useMemo(() => {
    let bestId: string | null = null;
    let bestParents: string[] = [];
    let bestPage = -1;

    for (const item of flatOutline) {
      if (item.pageNumber <= currentPage && item.pageNumber >= bestPage) {
        bestPage = item.pageNumber;
        bestId = item.id;
        bestParents = item.parentIds;
      }
    }

    return {
      activeOutlineId: bestId,
      activeParentIds: new Set(bestParents),
    };
  }, [flatOutline, currentPage]);

  const sortedBookmarks = useMemo(
    () => [...bookmarks].sort((a, b) => a.pageNumber - b.pageNumber),
    [bookmarks],
  );

  const activeBookmarkId = useMemo(() => {
    let latestId: string | null = null;
    for (const bm of sortedBookmarks) {
      if (bm.pageNumber === currentPage) latestId = bm.id;
    }
    return latestId;
  }, [sortedBookmarks, currentPage]);

  if (!isOpen) return null;

  return (
    <aside className="flex h-full w-full flex-col bg-muted/40 select-none">
      <Tabs defaultValue="outline" className="flex min-h-0 flex-1 flex-col">
        {/* Top switcher aligns 1:1 with the 48px PdfToolbar height and bottom hairline */}
        <div className="flex h-12 shrink-0 items-center border-b border-border bg-muted/30 px-2">
          <TabsList className="grid h-9 w-full grid-cols-3 rounded-lg border border-border/70 bg-muted/80 p-1">
            <TabsTrigger
              value="outline"
              className="gap-1.5 rounded-md text-xs data-[state=active]:bg-card data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-sm)]"
            >
              <ListTree size={16} strokeWidth={1.5} />
              <span>Contents</span>
            </TabsTrigger>
            <TabsTrigger
              value="bookmarks"
              className="gap-1.5 rounded-md text-xs data-[state=active]:bg-card data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-sm)]"
            >
              <Bookmark size={16} strokeWidth={1.5} />
              <span>Marks</span>
            </TabsTrigger>
            <TabsTrigger
              value="figures"
              className="gap-1.5 rounded-md text-xs data-[state=active]:bg-card data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-sm)]"
            >
              <Scan size={16} strokeWidth={1.5} />
              <span>Figures</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="outline"
          className="m-0 flex-1 overflow-y-auto px-2 py-2.5"
        >
          {outline.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                <ListTree size={16} strokeWidth={1.5} />
              </div>
              <p className="text-xs text-muted-foreground">
                No outline embedded in this PDF
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {outline.map((node) => (
                <OutlineItem
                  key={node.id}
                  node={node}
                  activeId={activeOutlineId}
                  activeParentIds={activeParentIds}
                  onJumpToPage={onJumpToPage}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="bookmarks"
          className="m-0 flex-1 overflow-y-auto px-2 py-2.5"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {bookmarks.length} saved
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onAddBookmark(currentPage)}
              className="h-7 gap-1 rounded-md px-2 text-xs"
            >
              <Plus size={16} strokeWidth={1.5} />
              <span>Page {pageLabels[currentPage - 1] || currentPage}</span>
            </Button>
          </div>

          {sortedBookmarks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                <Bookmark size={16} strokeWidth={1.5} />
              </div>
              <p className="text-xs text-muted-foreground">No bookmarks yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {sortedBookmarks.map((bm) => {
                const active = bm.id === activeBookmarkId;
                return (
                  <div
                    key={bm.id}
                    className={cn(
                      "group relative flex h-9 items-center justify-between gap-2 rounded-md px-2 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                      active
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-[var(--accent-brand)]"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => onJumpToPage(bm.pageNumber)}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    >
                      <Bookmark
                        size={16}
                        strokeWidth={1.5}
                        className="shrink-0 text-[var(--accent-brand)]"
                        fill="currentColor"
                      />
                      <span className="truncate">{bm.title}</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onDeleteBookmark(bm.id)}
                      aria-label="Remove bookmark"
                      className="h-6 w-6 rounded text-muted-foreground opacity-0 transition-opacity duration-150 ease-[var(--ease-foliet)] group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive"
                    >
                      <Trash2 size={16} strokeWidth={1.5} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="figures"
          className="m-0 flex-1 overflow-y-auto px-2 py-2.5"
        >
          {crops.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                <Scan size={16} strokeWidth={1.5} />
              </div>
              <p className="text-xs text-muted-foreground">
                Use the crop tool to capture figures
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {crops.map((crop) => (
                <div
                  key={crop.id}
                  draggable
                  onDragStart={(e) => {
                    const src = crop.imageUrl.startsWith("idb://")
                      ? crop.imageUrl
                      : `idb://${crop.id}`;
                    const alt =
                      crop.caption || `Figure (Page ${crop.pageNumber})`;
                    e.dataTransfer.setData(
                      "application/x-foliet-crop",
                      JSON.stringify({ src, alt }),
                    );
                    e.dataTransfer.setData("text/plain", `![${alt}](${src})`);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title="Click to jump · Drag into Living Summary"
                  className="group flex cursor-grab flex-col gap-2 rounded-xl border border-border bg-card p-2 transition-colors duration-150 ease-[var(--ease-foliet)] hover:border-[var(--hairline-strong)] active:cursor-grabbing"
                >
                  <button
                    type="button"
                    onClick={() => onJumpToPage(crop.pageNumber)}
                    className="w-full cursor-pointer text-left"
                  >
                    <CropThumbnail crop={crop} />
                  </button>
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      Page {pageLabels[crop.pageNumber - 1] || crop.pageNumber}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => onDeleteCrop(crop.id)}
                      aria-label="Delete figure"
                      className="h-6 w-6 rounded text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={16} strokeWidth={1.5} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
