import { useEffect, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PanelLeft,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface ViewerHeaderProps {
  currentPage: number;
  totalPages: number;
  currentLabel: string;
  zoomLevel: number;
  isSidebarOpen: boolean;
  isCurrentPageBookmarked: boolean;
  shortcutModifier: string;
  onToggleSidebar: () => void;
  onJumpToPage: (page: number) => void;
  onCommitPageInput: (val: string) => void;
  onZoomChange: (zoom: number) => void;
  onResetZoom: () => void;
  onFitToWidth: () => void;
  onToggleBookmark: () => void;
  onOpenSearch: () => void;
}

export function ViewerHeader({
  currentPage,
  totalPages,
  currentLabel,
  zoomLevel,
  isSidebarOpen,
  isCurrentPageBookmarked,
  shortcutModifier,
  onToggleSidebar,
  onJumpToPage,
  onCommitPageInput,
  onZoomChange,
  onResetZoom,
  onFitToWidth,
  onToggleBookmark,
  onOpenSearch,
}: ViewerHeaderProps) {
  const [pageDraft, setPageDraft] = useState(currentLabel);

  useEffect(() => {
    setPageDraft(currentLabel);
  }, [currentLabel]);

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3 select-none">
      {/* Left: Sidebar & Page Navigation */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title="Toggle sidebar"
          className={cn(
            "h-7 w-7",
            isSidebarOpen
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <PanelLeft size={16} strokeWidth={1.5} />
        </Button>

        <Separator orientation="vertical" className="mx-1 h-4" />

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={currentPage <= 1}
          onClick={() => onJumpToPage(currentPage - 1)}
          aria-label="Previous page"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </Button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCommitPageInput(pageDraft);
          }}
          className="flex items-center gap-1.5"
        >
          <Input
            value={pageDraft}
            onChange={(e) => setPageDraft(e.target.value)}
            onBlur={() => onCommitPageInput(pageDraft)}
            aria-label="Current page"
            className="h-7 w-12 px-1.5 text-center font-mono text-xs tabular-nums"
          />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            / {totalPages}
          </span>
        </form>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={currentPage >= totalPages}
          onClick={() => onJumpToPage(currentPage + 1)}
          aria-label="Next page"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </Button>
      </div>

      {/* Center: Zoom Controls */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onZoomChange(Math.max(25, zoomLevel - 15))}
          aria-label="Zoom out"
          title="Zoom out"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <ZoomOut size={16} strokeWidth={1.5} />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onResetZoom}
          title="Reset zoom to 100%"
          className="h-7 min-w-14 px-2 font-mono text-xs tabular-nums text-foreground"
        >
          {zoomLevel}%
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => onZoomChange(Math.min(500, zoomLevel + 15))}
          aria-label="Zoom in"
          title="Zoom in"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <ZoomIn size={16} strokeWidth={1.5} />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onFitToWidth}
          aria-label="Fit to width"
          title="Fit to width"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <Maximize2 size={16} strokeWidth={1.5} />
        </Button>
      </div>

      {/* Right: Search & Bookmark */}
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onOpenSearch}
          aria-label="Search document"
          title={`Search (${shortcutModifier}+F)`}
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <Search size={16} strokeWidth={1.5} />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onToggleBookmark}
          aria-label={
            isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page"
          }
          title={isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page"}
          className={cn(
            "h-7 w-7",
            isCurrentPageBookmarked
              ? "text-[var(--accent-brand)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Bookmark
            size={16}
            strokeWidth={1.5}
            fill={isCurrentPageBookmarked ? "currentColor" : "none"}
          />
        </Button>
      </div>
    </div>
  );
}
