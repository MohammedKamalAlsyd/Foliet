import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Eraser,
  Highlighter,
  MousePointer2,
  PenLine,
  Redo2,
  Scan,
  SlidersHorizontal,
  StickyNote,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";
import { ToolCustomizerModal } from "@/components/modals/ToolCustomizerModal";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  type ActiveToolState,
  type ToolPreset,
  type ToolType,
  type UnderlineStyle,
  isUtilityTool,
} from "@/types/tools";

export function ToolIcon({
  type,
  size = 16,
}: {
  type: ToolType;
  size?: number;
}) {
  const props = { size, strokeWidth: 1.5 };
  switch (type) {
    case "select":
      return <MousePointer2 {...props} />;
    case "highlight":
      return <Highlighter {...props} />;
    case "underline":
      return <Underline {...props} />;
    case "strikethrough":
      return <Strikethrough {...props} />;
    case "popup_note":
      return <StickyNote {...props} />;
    case "freehand_write":
      return <PenLine {...props} />;
    case "eraser":
      return <Eraser {...props} />;
    case "area_select":
      return <Scan {...props} />;
  }
}

interface PdfToolbarProps {
  presets: ToolPreset[];
  activeState: ActiveToolState;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTogglePreset: (id: string) => void;
  onSetSelectMode: () => void;
  onSetStrokeWidth: (w: number) => void;
  onSetUnderlineStyle: (s: UnderlineStyle) => void;
  onAddPreset: (preset: Omit<ToolPreset, "id">) => Promise<void>;
  onUpdatePreset: (preset: ToolPreset) => Promise<void>;
  onRemovePreset: (id: string) => Promise<void>;
  onResetPresets: () => Promise<void>;
}

export function PdfToolbar({
  presets,
  activeState,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onTogglePreset,
  onSetSelectMode,
  onSetStrokeWidth,
  onSetUnderlineStyle,
  onAddPreset,
  onUpdatePreset,
  onRemovePreset,
  onResetPresets,
}: PdfToolbarProps) {
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    presets[0]?.id ?? "",
  );

  const dropdownRef = useRef<HTMLDivElement>(null);
  const stylePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeState.activePresetId) {
      setSelectedPresetId(activeState.activePresetId);
    }
  }, [activeState.activePresetId]);

  const activePreset =
    presets.find((p) => p.id === selectedPresetId) ?? presets[0];

  const isSelectActive = activeState.toolType === "select";
  const isAnnotatorActive =
    !isSelectActive &&
    Boolean(activePreset) &&
    activeState.activePresetId === activePreset?.id;

  useEffect(() => {
    if (!dropdownOpen && !stylePopoverOpen) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setDropdownOpen(false);
      }
      if (
        stylePopoverOpen &&
        stylePopoverRef.current &&
        !stylePopoverRef.current.contains(target)
      ) {
        setStylePopoverOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setStylePopoverOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dropdownOpen, stylePopoverOpen]);

  return (
    <>
      <div className="relative z-30 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 select-none">
        {/* Left: Select Mode, Grouped Tool Split-Button, Contextual Style */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSetSelectMode}
            title="Text selection (V or Esc)"
            className={cn(
              "h-8 gap-2 px-2.5 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
              isSelectActive
                ? "border border-border bg-card font-medium text-foreground shadow-[var(--shadow-sm)]"
                : "border border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <ToolIcon type="select" />
            <span>Select</span>
            <kbd className="hidden sm:inline-flex">V</kbd>
          </Button>

          {/* Grouped Annotation Tools Split-Button + Dropdown */}
          <div ref={dropdownRef} className="relative flex items-center">
            <div
              className={cn(
                "flex h-8 items-center overflow-hidden rounded-lg border transition-colors duration-150 ease-[var(--ease-foliet)]",
                isAnnotatorActive
                  ? "border-[var(--accent-brand)] bg-card text-foreground shadow-[var(--shadow-sm)]"
                  : "border-border bg-background text-muted-foreground hover:border-[var(--hairline-strong)]",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  if (activePreset) onTogglePreset(activePreset.id);
                }}
                title={
                  activePreset
                    ? `${activePreset.label} (${activePreset.shortcut.toUpperCase()})`
                    : "Annotation tools"
                }
                className="flex h-full cursor-pointer items-center gap-2 px-2.5 text-xs transition-colors duration-150 ease-[var(--ease-foliet)] hover:bg-accent/60"
              >
                {activePreset && !isUtilityTool(activePreset.toolType) && (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/15"
                    style={{ backgroundColor: activePreset.color }}
                  />
                )}
                {activePreset && (
                  <span
                    className={cn(
                      "shrink-0",
                      isAnnotatorActive
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <ToolIcon type={activePreset.toolType} />
                  </span>
                )}
                <span
                  className={cn(
                    "max-w-32 truncate text-xs",
                    isAnnotatorActive
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {activePreset?.label ?? "Annotate"}
                </span>
                {activePreset && (
                  <kbd className="hidden uppercase md:inline-flex">
                    {activePreset.shortcut}
                  </kbd>
                )}
              </button>

              <div className="h-4 w-px shrink-0 bg-border" />

              <button
                type="button"
                onClick={() => setDropdownOpen((p) => !p)}
                aria-label="Choose annotation tool"
                aria-expanded={dropdownOpen}
                title="All annotation tools"
                className={cn(
                  "flex h-full cursor-pointer items-center justify-center px-2 transition-colors duration-150 ease-[var(--ease-foliet)] hover:bg-accent/60",
                  dropdownOpen
                    ? "text-[var(--accent-brand)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ChevronDown
                  size={16}
                  strokeWidth={1.5}
                  className={cn(
                    "transition-transform duration-150 ease-[var(--ease-foliet)]",
                    dropdownOpen && "rotate-180",
                  )}
                />
              </button>
            </div>

            {dropdownOpen && (
              <div
                role="menu"
                className="absolute left-0 top-10 z-50 w-64 rounded-xl border border-border bg-card p-1 shadow-[var(--shadow-float)]"
              >
                <div className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                  Annotation tools
                </div>

                <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                  {presets.map((preset) => {
                    const isCurrentlyActive =
                      activeState.activePresetId === preset.id;
                    const isLastSelected = activePreset?.id === preset.id;
                    const utility = isUtilityTool(preset.toolType);

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setSelectedPresetId(preset.id);
                          onTogglePreset(preset.id);
                          setDropdownOpen(false);
                        }}
                        className={cn(
                          "flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                          isCurrentlyActive
                            ? "bg-accent font-medium text-foreground"
                            : isLastSelected
                              ? "bg-accent/50 text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                            {!utility && (
                              <span
                                className="h-2.5 w-2.5 rounded-full border border-black/15"
                                style={{ backgroundColor: preset.color }}
                              />
                            )}
                          </span>
                          <span className="shrink-0">
                            <ToolIcon type={preset.toolType} />
                          </span>
                          <span className="truncate">{preset.label}</span>
                        </span>

                        <span className="flex shrink-0 items-center gap-2">
                          {isCurrentlyActive && (
                            <Check
                              size={16}
                              strokeWidth={1.5}
                              className="text-[var(--accent-brand)]"
                            />
                          )}
                          <kbd className="uppercase">{preset.shortcut}</kbd>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <Separator className="my-1" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDropdownOpen(false);
                    setCustomizerOpen(true);
                  }}
                  className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:bg-accent hover:text-foreground"
                >
                  <SlidersHorizontal size={16} strokeWidth={1.5} />
                  <span>Customize tools</span>
                </button>
              </div>
            )}
          </div>

          {/* Contextual Style Popover for Pen / Underline */}
          {(activeState.toolType === "freehand_write" ||
            activeState.toolType === "underline") && (
            <div ref={stylePopoverRef} className="relative">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStylePopoverOpen((p) => !p)}
                title="Tool style options"
                className="h-8 gap-1.5 px-2.5 text-xs"
              >
                <span className="font-mono text-xs tabular-nums capitalize">
                  {activeState.toolType === "freehand_write"
                    ? `${activeState.strokeWidth}px`
                    : activeState.underlineStyle}
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={1.5}
                  className={cn(
                    "text-muted-foreground transition-transform duration-150 ease-[var(--ease-foliet)]",
                    stylePopoverOpen && "rotate-180",
                  )}
                />
              </Button>

              {stylePopoverOpen && (
                <div className="absolute left-0 top-10 z-50 w-44 rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-float)]">
                  {activeState.toolType === "freehand_write" && (
                    <div className="flex flex-col gap-2">
                      <span className="px-1 text-xs font-medium text-muted-foreground">
                        Pen thickness
                      </span>
                      <div className="grid grid-cols-3 gap-1">
                        {[1.5, 3, 5].map((w) => (
                          <Button
                            key={w}
                            type="button"
                            variant={
                              activeState.strokeWidth === w
                                ? "secondary"
                                : "ghost"
                            }
                            size="sm"
                            onClick={() => {
                              onSetStrokeWidth(w);
                              setStylePopoverOpen(false);
                            }}
                            className={cn(
                              "h-8 font-mono text-xs tabular-nums",
                              activeState.strokeWidth === w &&
                                "border border-[var(--accent-brand)] text-foreground",
                            )}
                          >
                            {w}px
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeState.toolType === "underline" && (
                    <div className="flex flex-col gap-2">
                      <span className="px-1 text-xs font-medium text-muted-foreground">
                        Underline style
                      </span>
                      <div className="flex flex-col gap-1">
                        {(
                          ["solid", "squiggle", "dashed"] as UnderlineStyle[]
                        ).map((style) => (
                          <Button
                            key={style}
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              onSetUnderlineStyle(style);
                              setStylePopoverOpen(false);
                            }}
                            className={cn(
                              "h-8 justify-between px-2 text-xs capitalize",
                              activeState.underlineStyle === style &&
                                "bg-accent font-medium text-foreground",
                            )}
                          >
                            <span>{style}</span>
                            {activeState.underlineStyle === style && (
                              <Check
                                size={16}
                                strokeWidth={1.5}
                                className="text-[var(--accent-brand)]"
                              />
                            )}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: History & Quick Customize */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="Undo"
            title="Undo"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Undo2 size={16} strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!canRedo}
            onClick={onRedo}
            aria-label="Redo"
            title="Redo"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <Redo2 size={16} strokeWidth={1.5} />
          </Button>

          <Separator orientation="vertical" className="mx-1 h-4" />

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setCustomizerOpen(true)}
            aria-label="Customize tools"
            title="Customize tools"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal size={16} strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <ToolCustomizerModal
        open={customizerOpen}
        onOpenChange={setCustomizerOpen}
        presets={presets}
        onAddPreset={onAddPreset}
        onUpdatePreset={onUpdatePreset}
        onRemovePreset={onRemovePreset}
        onResetPresets={onResetPresets}
      />
    </>
  );
}
