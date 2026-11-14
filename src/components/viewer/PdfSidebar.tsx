import { useEffect, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BinaryStorage } from "@/services/storage/binary";
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
  currentPage,
  onJumpToPage,
}: {
  node: PdfOutlineNode;
  currentPage: number;
  onJumpToPage: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(node.level < 1);
  const hasChildren = Boolean(node.children?.length);
  const active = node.pageNumber === currentPage;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md py-1 pr-2 text-xs transition-colors duration-150 ease-[var(--ease-foliet)] hover:bg-accent",
          active
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground",
        )}
        style={{ paddingLeft: `${8 + node.level * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            aria-label={expanded ? "Collapse section" : "Expand section"}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown size={14} strokeWidth={1.5} />
            ) : (
              <ChevronRight size={14} strokeWidth={1.5} />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onJumpToPage(node.pageNumber)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span className="truncate">{node.title}</span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {node.pageNumber}
          </span>
        </button>
      </div>

      {hasChildren && expanded && (
        <div className="flex flex-col">
          {node.children!.map((child) => (
            <OutlineItem
              key={child.id}
              node={child}
              currentPage={currentPage}
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
      BinaryStorage.getFigureCrop(crop.id).then((data) => {
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
      className="max-h-36 w-full rounded-md border border-border bg-background object-contain"
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
  if (!isOpen) return null;

  const sortedBookmarks = [...bookmarks].sort(
    (a, b) => a.pageNumber - b.pageNumber,
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/30 select-none">
      <Tabs defaultValue="outline" className="flex min-h-0 flex-1 flex-col">
        <div className="p-2">
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="outline" className="gap-1.5 text-xs">
              <ListTree size={14} strokeWidth={1.5} />
              <span>Contents</span>
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="gap-1.5 text-xs">
              <Bookmark size={14} strokeWidth={1.5} />
              <span>Marks</span>
            </TabsTrigger>
            <TabsTrigger value="figures" className="gap-1.5 text-xs">
              <Scan size={14} strokeWidth={1.5} />
              <span>Figures</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <Separator />

        <TabsContent value="outline" className="m-0 flex-1 overflow-y-auto p-2">
          {outline.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              No outline embedded in this PDF
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {outline.map((node) => (
                <OutlineItem
                  key={node.id}
                  node={node}
                  currentPage={currentPage}
                  onJumpToPage={onJumpToPage}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="bookmarks"
          className="m-0 flex-1 overflow-y-auto p-2"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {bookmarks.length} saved
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onAddBookmark(currentPage)}
              className="h-7 gap-1 px-2 text-xs"
            >
              <Plus size={14} strokeWidth={1.5} />
              <span>Page {pageLabels[currentPage - 1] || currentPage}</span>
            </Button>
          </div>

          {sortedBookmarks.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              No bookmarks yet
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {sortedBookmarks.map((bm) => {
                const active = bm.pageNumber === currentPage;
                return (
                  <div
                    key={bm.id}
                    className={cn(
                      "group flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors duration-150 ease-[var(--ease-foliet)] hover:bg-accent",
                      active && "bg-accent font-medium text-foreground",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onJumpToPage(bm.pageNumber)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Bookmark
                        size={14}
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
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="figures" className="m-0 flex-1 overflow-y-auto p-2">
          {crops.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              Use the crop tool to capture figures
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {crops.map((crop) => (
                <div
                  key={crop.id}
                  className="group flex flex-col gap-2 rounded-lg border border-border bg-card p-2"
                >
                  <button
                    type="button"
                    onClick={() => onJumpToPage(crop.pageNumber)}
                    className="w-full text-left"
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
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
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
