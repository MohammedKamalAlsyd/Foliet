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
  RefreshCw,
} from "lucide-react";
import { LogoIcon } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { WindowService } from "@/services/window";
import { useSystemStore } from "@/stores/systemStore";
import { useDocumentStore } from "@/stores/documentStore";

const TRAFFIC_COLORS = {
  close: "border-[#E0443E] bg-[#FF5F56] text-[#4C0000]",
  minimize: "border-[#DEA123] bg-[#FFBD2E] text-[#5B3C00]",
  zoom: "border-[#1AAB29] bg-[#27C93F] text-[#004D00]",
} as const;

interface TitlebarProps {
  onRequestClose?: () => void;
  onNavigateHome?: () => void;
  onCheckForUpdates?: () => void;
  isCheckingUpdates?: boolean;
  hasUpdateAvailable?: boolean;
}

export function Titlebar({
  onRequestClose,
  onNavigateHome,
  onCheckForUpdates,
  isCheckingUpdates = false,
  hasUpdateAvailable = false,
}: TitlebarProps) {
  const isMac = useSystemStore((s) => s.isMac);
  const shortcutModifier = useSystemStore((s) => s.shortcutModifier);
  const isDark = useSystemStore((s) => s.isDark);
  const toggleTheme = useSystemStore((s) => s.toggleTheme);

  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const isSaving = useDocumentStore((s) => s.isSaving);
  const closeDocument = useDocumentStore((s) => s.closeDocument);

  const [isMaximized, setIsMaximized] = useState(false);
  const [trafficHovered, setTrafficHovered] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const maximized = await WindowService.isMaximized();
        if (!active) return;
        setIsMaximized(maximized);

        const stop = await WindowService.onMaximizeChange((next) => {
          if (active) setIsMaximized(next);
        });
        if (!active) return stop?.();
        unlisten = stop;
      } catch (err) {
        console.warn("Titlebar: WindowService unavailable", err);
      }
    })();

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    try {
      setIsMaximized(await WindowService.toggleMaximize());
    } catch {
      setIsMaximized((prev) => !prev);
    }
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (
        (e.target as HTMLElement).closest(
          "button, a, input, [role='button'], .no-drag",
        )
      ) {
        return;
      }
      handleToggleMaximize();
    },
    [handleToggleMaximize],
  );

  const handleClose = useCallback(
    () => (onRequestClose ? onRequestClose() : WindowService.close()),
    [onRequestClose],
  );

  const handleHome = useCallback(
    () => (onNavigateHome ? onNavigateHome() : closeDocument()),
    [onNavigateHome, closeDocument],
  );

  const trafficLights = [
    {
      key: "close",
      label: "Close window",
      title: "Close",
      Icon: X,
      onClick: handleClose,
    },
    {
      key: "minimize",
      label: "Minimize window",
      title: "Minimize",
      Icon: Minus,
      onClick: () => WindowService.minimize(),
    },
    {
      key: "zoom",
      label: isMaximized ? "Restore window" : "Zoom window",
      title: isMaximized ? "Restore" : "Zoom",
      Icon: Plus,
      onClick: handleToggleMaximize,
    },
  ] as const;

  const winControls = [
    {
      label: "Minimize window",
      title: "Minimize",
      Icon: Minus,
      onClick: () => WindowService.minimize(),
      danger: false,
    },
    {
      label: isMaximized ? "Restore window" : "Maximize window",
      title: isMaximized ? "Restore" : "Maximize",
      Icon: isMaximized ? Copy : Square,
      onClick: handleToggleMaximize,
      danger: false,
    },
    {
      label: "Close window",
      title: "Close",
      Icon: X,
      onClick: handleClose,
      danger: true,
    },
  ];

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      className={cn(
        "relative z-50 grid h-9 shrink-0 select-none grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background",
        isMac ? "px-3" : "pl-3 pr-0",
      )}
    >
      {/* Left: Traffic Lights + Brand / Back to Library */}
      <div className="flex min-w-0 items-center gap-2">
        {isMac && (
          <div
            className="no-drag flex items-center gap-2 pr-2"
            onMouseEnter={() => setTrafficHovered(true)}
            onMouseLeave={() => setTrafficHovered(false)}
          >
            {trafficLights.map(({ key, label, title, Icon, onClick }) => (
              <button
                key={key}
                type="button"
                onClick={onClick}
                aria-label={label}
                title={title}
                className={cn(
                  "flex h-3 w-3 cursor-pointer items-center justify-center rounded-full border transition-[transform,opacity] duration-150 ease-[var(--ease-foliet)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  TRAFFIC_COLORS[key],
                )}
              >
                <Icon
                  size={8}
                  strokeWidth={2}
                  className={cn(
                    "transition-opacity duration-150 ease-[var(--ease-foliet)]",
                    trafficHovered ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            ))}
          </div>
        )}

        <div className="no-drag flex items-center">
          {activeDoc ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleHome}
              title="Back to Library"
              className="h-7 gap-2 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
              <span>Library</span>
            </Button>
          ) : (
            <div className="flex items-center gap-2 px-2">
              <LogoIcon size={16} />
              <span className="font-sans text-xs font-medium tracking-tight text-foreground">
                Foliet
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Center: Context / Active Document & Save Status */}
      <div className="pointer-events-none flex min-w-0 max-w-md items-center gap-2 px-2">
        {activeDoc && (
          <FileText
            size={16}
            strokeWidth={1.5}
            className="shrink-0 text-muted-foreground"
          />
        )}
        <span className="truncate font-sans text-xs font-medium text-foreground">
          {activeDoc ? activeDoc.title || "Untitled document" : "Library"}
        </span>

        {activeDoc && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <div className="flex shrink-0 items-center font-mono text-xs tabular-nums">
              {isSaving ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2
                    size={16}
                    strokeWidth={1.5}
                    className="animate-spin"
                  />
                  <span className="hidden sm:inline">Saving</span>
                </span>
              ) : isDirty ? (
                <span
                  className="flex items-center gap-2 text-foreground"
                  title={`Unsaved edits — press ${shortcutModifier}+S to save`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-brand)]" />
                  <span className="hidden sm:inline">Unsaved</span>
                  <kbd className="hidden sm:inline-flex">
                    {shortcutModifier}S
                  </kbd>
                </span>
              ) : (
                <span
                  className="flex items-center gap-2 text-muted-foreground"
                  title="Synchronized with PDF file"
                >
                  <Check
                    size={16}
                    strokeWidth={1.5}
                    className="text-[var(--semantic-positive)]"
                  />
                  <span className="hidden sm:inline">Saved</span>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: Update Check, Theme Toggle & Window Controls */}
      <div className="flex h-full items-center justify-end gap-1">
        {onCheckForUpdates && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCheckForUpdates}
            disabled={isCheckingUpdates}
            aria-label={
              hasUpdateAvailable ? "Update available" : "Check for updates"
            }
            title={
              hasUpdateAvailable
                ? "Update available — click to install"
                : isCheckingUpdates
                  ? "Checking for updates…"
                  : "Check for updates"
            }
            className="no-drag relative h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw
              size={15}
              strokeWidth={1.5}
              className={cn(isCheckingUpdates && "animate-spin")}
            />
            {hasUpdateAvailable && !isCheckingUpdates && (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-[var(--accent-brand,#2563EB)]"
              />
            )}
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Light mode" : "Dark mode"}
          className={cn(
            "no-drag h-7 w-7 text-muted-foreground hover:text-foreground",
            !isMac && "mr-2",
          )}
        >
          {isDark ? (
            <Sun size={16} strokeWidth={1.5} />
          ) : (
            <Moon size={16} strokeWidth={1.5} />
          )}
        </Button>

        {!isMac && (
          <div className="no-drag flex h-full items-center">
            {winControls.map(({ label, title, Icon, onClick, danger }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClick}
                aria-label={label}
                title={title}
                className={cn(
                  "h-9 w-11 rounded-none text-muted-foreground",
                  danger
                    ? "hover:bg-[var(--semantic-negative)] hover:text-white"
                    : "hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon size={16} strokeWidth={1.5} />
              </Button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

export default Titlebar;
