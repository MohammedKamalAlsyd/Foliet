import { useState, useEffect, useCallback } from "react";
import {
  Sun,
  Moon,
  Minus,
  Square,
  X,
  Copy,
  FileText,
  Check,
  ChevronLeft,
  Plus,
  Loader2,
} from "lucide-react";
import { LogoIcon } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WindowService } from "@/services/window";
import { useSystemStore } from "@/stores/systemStore";
import { useDocumentStore } from "@/stores/documentStore";
import { TitlebarProps } from "@/types/props";

export function Titlebar({ onRequestClose, onNavigateHome }: TitlebarProps) {
  const isMac = useSystemStore((state) => state.isMac);
  const shortcutModifier = useSystemStore((state) => state.shortcutModifier);
  const isDark = useSystemStore((state) => state.isDark);
  const toggleTheme = useSystemStore((state) => state.toggleTheme);

  const activeDoc = useDocumentStore((state) => state.activeDoc);
  const isViewerOpen = useDocumentStore((state) => state.isViewerOpen);
  const isDirty = useDocumentStore((state) => state.isDirty);
  const isSaving = useDocumentStore((state) => state.isSaving);
  const closeDocument = useDocumentStore((state) => state.closeDocument);

  const [isMaximized, setIsMaximized] = useState(false);
  const [isTrafficHovered, setIsTrafficHovered] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    async function initListener() {
      try {
        const maximized = await WindowService.isMaximized();
        if (!active) return;
        setIsMaximized(maximized);

        const stop = await WindowService.onMaximizeChange((nextMaximized) => {
          if (active) setIsMaximized(nextMaximized);
        });

        if (!active) {
          stop?.();
          return;
        }
        unlisten = stop;
      } catch (err) {
        console.warn(
          "Titlebar: WindowService not available in this environment",
          err,
        );
      }
    }

    initListener();
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    try {
      const nextMaximized = await WindowService.toggleMaximize();
      setIsMaximized(nextMaximized);
    } catch {
      setIsMaximized((prev) => !prev);
    }
  }, []);

  const handleHeaderDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, a, input, [role='button'], .no-drag")) {
        return;
      }
      handleToggleMaximize();
    },
    [handleToggleMaximize],
  );

  const handleRequestClose = useCallback(() => {
    if (onRequestClose) {
      onRequestClose();
    } else {
      WindowService.close();
    }
  }, [onRequestClose]);

  const handleNavigateHome = useCallback(() => {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      closeDocument();
    }
  }, [onNavigateHome, closeDocument]);

  const renderMacTrafficLights = () => (
    <div
      className="no-drag flex items-center gap-2 pl-1 pr-3"
      onMouseEnter={() => setIsTrafficHovered(true)}
      onMouseLeave={() => setIsTrafficHovered(false)}
    >
      <button
        type="button"
        onClick={handleRequestClose}
        aria-label="Close window"
        title="Close"
        className="flex h-3 w-3 cursor-pointer items-center justify-center rounded-full border border-[#E0443E] bg-[#FF5F56] transition-[filter] duration-150 active:brightness-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X
          size={8}
          strokeWidth={2.5}
          className={cn(
            "text-[#4C0000] transition-opacity duration-150",
            isTrafficHovered ? "opacity-100" : "opacity-0",
          )}
        />
      </button>

      <button
        type="button"
        onClick={() => WindowService.minimize()}
        aria-label="Minimize window"
        title="Minimize"
        className="flex h-3 w-3 cursor-pointer items-center justify-center rounded-full border border-[#DEA123] bg-[#FFBD2E] transition-[filter] duration-150 active:brightness-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Minus
          size={8}
          strokeWidth={2.5}
          className={cn(
            "text-[#5B3C00] transition-opacity duration-150",
            isTrafficHovered ? "opacity-100" : "opacity-0",
          )}
        />
      </button>

      <button
        type="button"
        onClick={handleToggleMaximize}
        aria-label={isMaximized ? "Restore window" : "Zoom window"}
        title={isMaximized ? "Restore" : "Zoom"}
        className="flex h-3 w-3 cursor-pointer items-center justify-center rounded-full border border-[#1AAB29] bg-[#27C93F] transition-[filter] duration-150 active:brightness-75 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Plus
          size={8}
          strokeWidth={2.5}
          className={cn(
            "text-[#004D00] transition-opacity duration-150",
            isTrafficHovered ? "opacity-100" : "opacity-0",
          )}
        />
      </button>
    </div>
  );

  const renderWindowsLinuxControls = () => (
    <div className="no-drag flex h-full items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => WindowService.minimize()}
        aria-label="Minimize window"
        title="Minimize"
        className="h-9 w-11 rounded-none text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <Minus size={14} strokeWidth={1.5} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleToggleMaximize}
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        title={isMaximized ? "Restore" : "Maximize"}
        className="h-9 w-11 rounded-none text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        {isMaximized ? (
          <Copy size={12} strokeWidth={1.5} />
        ) : (
          <Square size={12} strokeWidth={1.5} />
        )}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleRequestClose}
        aria-label="Close window"
        title="Close"
        className="h-9 w-11 rounded-none text-muted-foreground hover:bg-[#E81123] hover:text-white"
      >
        <X size={14} strokeWidth={1.5} />
      </Button>
    </div>
  );

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleHeaderDoubleClick}
      className={cn(
        "relative z-50 grid h-9 shrink-0 select-none grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background/95 backdrop-blur-sm",
        isMac ? "px-3" : "pl-3 pr-0",
      )}
    >
      {/* Left: Traffic Lights + Brand / Back to Library */}
      <div className="flex min-w-0 items-center gap-2">
        {isMac && renderMacTrafficLights()}

        <div className="no-drag flex items-center gap-1.5">
          {isViewerOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleNavigateHome}
              title="Return to Library"
              className="h-7 gap-1.5 px-2 text-foreground hover:bg-accent"
            >
              <LogoIcon size={16} />
              <span className="font-sans text-xs font-semibold tracking-tight">
                foliet
              </span>
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 px-1.5">
              <LogoIcon size={16} />
              <span className="font-sans text-xs font-semibold tracking-tight text-foreground">
                foliet
              </span>
            </div>
          )}

          {isViewerOpen && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleNavigateHome}
              title="Back to Library"
              className="h-7 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft size={14} strokeWidth={1.5} />
              <span>Library</span>
            </Button>
          )}
        </div>
      </div>

      {/* Center: Active Document Title & Save State */}
      <div className="pointer-events-none flex min-w-0 max-w-md items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1">
        <FileText
          size={14}
          strokeWidth={1.5}
          className="shrink-0 text-muted-foreground"
        />
        <span className="truncate font-sans text-xs font-medium text-foreground">
          {isViewerOpen ? activeDoc?.title || "Untitled document" : "Library"}
        </span>

        {isViewerOpen && (
          <div className="flex shrink-0 items-center gap-2 border-l border-border pl-2">
            {isSaving ? (
              <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <Loader2
                  size={12}
                  className="animate-spin text-muted-foreground"
                />
                <span className="hidden sm:inline">Saving</span>
              </span>
            ) : isDirty ? (
              <span
                className="flex items-center gap-1.5 font-mono text-xs text-amber-600 dark:text-amber-400"
                title={`Unsaved edits — press ${shortcutModifier}+S to save`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
                <span className="hidden sm:inline">Unsaved</span>
                <kbd className="hidden h-4 items-center rounded border border-border bg-background px-1 font-mono text-[10px] text-muted-foreground sm:inline-flex">
                  {shortcutModifier}S
                </kbd>
              </span>
            ) : (
              <span
                className="flex items-center gap-1 font-mono text-xs text-muted-foreground"
                title="Synchronized with PDF file"
              >
                <Check
                  size={12}
                  strokeWidth={2}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                <span className="hidden sm:inline">Saved</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Right: Theme Toggle & Window Controls */}
      <div className="flex h-full items-center justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Light mode" : "Dark mode"}
          className={cn(
            "no-drag h-7 w-7 text-muted-foreground hover:text-foreground",
            isMac ? "mr-0" : "mr-2",
          )}
        >
          {isDark ? (
            <Sun size={15} strokeWidth={1.5} />
          ) : (
            <Moon size={15} strokeWidth={1.5} />
          )}
        </Button>

        {!isMac && renderWindowsLinuxControls()}
      </div>
    </header>
  );
}

export default Titlebar;
