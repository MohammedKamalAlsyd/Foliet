import { useEffect, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Contrast,
  FileText,
  Maximize2,
  MoonStar,
  PanelLeft,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PdfDarkModeSetting } from "@/utils/pdfDarkMode";

interface ViewerHeaderProps {
  currentPage: number;
  totalPages: number;
  currentLabel: string;
  zoomLevel: number;
  isSidebarOpen: boolean;
  isCurrentPageBookmarked: boolean;
  isDarkTheme: boolean;
  pdfDarkMode: PdfDarkModeSetting;
  shortcutModifier: string;
  onToggleSidebar: () => void;
  onJumpToPage: (page: number) => void;
  onCommitPageInput: (val: string) => void;
  onZoomChange: (zoom: number) => void;
  onResetZoom: () => void;
  onFitToWidth: () => void;
  onCyclePdfDarkMode: () => void;
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
  isDarkTheme,
  pdfDarkMode,
  shortcutModifier,
  onToggleSidebar,
  onJumpToPage,
  onCommitPageInput,
  onZoomChange,
  onResetZoom,
  onFitToWidth,
  onCyclePdfDarkMode,
  onToggleBookmark,
  onOpenSearch,
}: ViewerHeaderProps) {
  const [pageDraft, setPageDraft] = useState(currentLabel);

  useEffect(() => {
    setPageDraft(currentLabel);
  }, [currentLabel]);

  const pdfDarkModeMeta =
    pdfDarkMode === "smart"
      ? {
          shortLabel: "Smart",
          ariaLabel: "PDF dark pages: Smart mode (click to switch)",
          tooltip:
            "Dark Pages: Smart — darkens text, enhances scans, preserves covers & dark slides",
          Icon: MoonStar,
          isActive: true,
        }
      : pdfDarkMode === "force"
        ? {
            shortLabel: "Force",
            ariaLabel: "PDF dark pages: Force dark on all pages (click to switch)",
            tooltip: "Dark Pages: Force All — darkens every page including covers",
            Icon: Contrast,
            isActive: true,
          }
        : {
            shortLabel: "Paper",
            ariaLabel: "PDF dark pages: Original paper (click to switch)",
            tooltip: "Dark Pages: Off — showing original PDF paper colors",
            Icon: FileText,
            isActive: false,
          };
  const PdfDarkModeIcon = pdfDarkModeMeta.Icon;

  return (
    <TooltipProvider>
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-background px-3 select-none">
        {/* Left: Sidebar toggle + Zoom controls */}
        <div className="flex items-center gap-1 justify-self-start">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onToggleSidebar}
                  aria-label="Toggle sidebar"
                  aria-pressed={isSidebarOpen}
                  className={cn(
                    "h-9 w-9 rounded-lg transition-colors duration-150 ease-[var(--ease-foliet)]",
                    isSidebarOpen
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                />
              }
            >
              <PanelLeft size={18} strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle sidebar</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-5" />

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onZoomChange(Math.max(25, zoomLevel - 15))}
                  aria-label="Zoom out"
                  className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
                />
              }
            >
              <ZoomOut size={18} strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom out</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onResetZoom}
                  aria-label="Reset zoom to 100%"
                  className="h-9 min-w-16 rounded-lg px-2.5 font-mono text-xs tabular-nums text-foreground transition-colors duration-150 ease-[var(--ease-foliet)]"
                />
              }
            >
              {zoomLevel}%
            </TooltipTrigger>
            <TooltipContent side="bottom">Reset zoom to 100%</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onZoomChange(Math.min(500, zoomLevel + 15))}
                  aria-label="Zoom in"
                  className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
                />
              }
            >
              <ZoomIn size={18} strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipContent side="bottom">Zoom in</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onFitToWidth}
                  aria-label="Fit to width"
                  className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
                />
              }
            >
              <Maximize2 size={18} strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipContent side="bottom">Fit to width</TooltipContent>
          </Tooltip>
        </div>

        {/* Middle: Page navigation */}
        <div className="flex items-center gap-1 justify-self-center">
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={currentPage <= 1}
                onClick={() => onJumpToPage(currentPage - 1)}
                aria-label="Previous page"
                className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
              >
                <ChevronLeft size={18} strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Previous page</TooltipContent>
          </Tooltip>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCommitPageInput(pageDraft);
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={pageDraft}
              onChange={(e) => setPageDraft(e.target.value)}
              onBlur={() => onCommitPageInput(pageDraft)}
              aria-label="Current page"
              className="h-9 w-16 rounded-lg px-2 text-center font-mono text-xs tabular-nums"
            />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              / {totalPages}
            </span>
          </form>

          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={currentPage >= totalPages}
                onClick={() => onJumpToPage(currentPage + 1)}
                aria-label="Next page"
                className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
              >
                <ChevronRight size={18} strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Next page</TooltipContent>
          </Tooltip>
        </div>

        {/* Right: PDF Dark Pages + Search + Bookmark */}
        <div className="flex items-center gap-1 justify-self-end">
          {isDarkTheme && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onCyclePdfDarkMode}
                    aria-label={pdfDarkModeMeta.ariaLabel}
                    aria-pressed={pdfDarkModeMeta.isActive}
                    className={cn(
                      "h-9 gap-1.5 rounded-lg px-2.5 transition-colors duration-150 ease-[var(--ease-foliet)]",
                      pdfDarkModeMeta.isActive
                        ? "bg-accent/70 text-foreground hover:bg-accent"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  />
                }
              >
                <PdfDarkModeIcon
                  size={16}
                  strokeWidth={1.5}
                  className={cn(
                    pdfDarkModeMeta.isActive && "text-[var(--accent-brand)]",
                  )}
                />
                <span className="hidden text-[11px] font-medium sm:inline">
                  {pdfDarkModeMeta.shortLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {pdfDarkModeMeta.tooltip}
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onOpenSearch}
                  aria-label="Search document"
                  className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
                />
              }
            >
              <Search size={18} strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Search ({shortcutModifier}+F)
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={onToggleBookmark}
                  aria-label={
                    isCurrentPageBookmarked
                      ? "Remove bookmark"
                      : "Bookmark page"
                  }
                  aria-pressed={isCurrentPageBookmarked}
                  className={cn(
                    "h-9 w-9 rounded-lg transition-colors duration-150 ease-[var(--ease-foliet)]",
                    isCurrentPageBookmarked
                      ? "text-[var(--accent-brand)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                />
              }
            >
              <Bookmark
                size={18}
                strokeWidth={1.5}
                fill={isCurrentPageBookmarked ? "currentColor" : "none"}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page"}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
