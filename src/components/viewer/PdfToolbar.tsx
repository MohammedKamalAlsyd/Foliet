import { useEffect, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  size = 18,
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

  return (
    <TooltipProvider>
      <div className="relative z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 select-none">
        {/* Left: History */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!canUndo}
                onClick={onUndo}
                aria-label="Undo"
                className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
              >
                <Undo2 size={18} strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Undo</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!canRedo}
                onClick={onRedo}
                aria-label="Redo"
                className="h-9 w-9 rounded-lg text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)] hover:text-foreground"
              >
                <Redo2 size={18} strokeWidth={1.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Redo</TooltipContent>
          </Tooltip>
        </div>

        {/* Right: Contextual Style, Select Mode, Grouped Tool Split-Button */}
        <div className="flex items-center gap-2">
          {(activeState.toolType === "freehand_write" ||
            activeState.toolType === "underline") && (
            <Popover open={stylePopoverOpen} onOpenChange={setStylePopoverOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label="Tool style options"
                    className="h-9 gap-2 rounded-lg px-3 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]"
                  />
                }
              >
                <span className="font-mono text-xs tabular-nums capitalize">
                  {activeState.toolType === "freehand_write"
                    ? `${activeState.strokeWidth}px`
                    : activeState.underlineStyle}
                </span>
                <ChevronDown
                  size={18}
                  strokeWidth={1.5}
                  className={cn(
                    "text-muted-foreground transition-transform duration-150 ease-[var(--ease-foliet)]",
                    stylePopoverOpen && "rotate-180",
                  )}
                />
              </PopoverTrigger>

              <PopoverContent
                align="end"
                sideOffset={8}
                className="w-44 rounded-xl border-border bg-card p-2 shadow-[var(--shadow-float)]"
              >
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
                            "h-8 rounded-md font-mono text-xs tabular-nums",
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
                            "h-8 justify-between rounded-md px-2 text-xs capitalize",
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
              </PopoverContent>
            </Popover>
          )}

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onSetSelectMode}
                  aria-pressed={isSelectActive}
                  className={cn(
                    "h-9 gap-2 rounded-lg border px-3 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                    isSelectActive
                      ? "border-border bg-card font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                />
              }
            >
              <ToolIcon type="select" />
              <span>Select</span>
              <kbd className="hidden sm:inline-flex">V</kbd>
            </TooltipTrigger>
            <TooltipContent side="bottom">Text selection (V)</TooltipContent>
          </Tooltip>

          {/* Grouped Annotation Tools Split-Button + Dropdown */}
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <div
              className={cn(
                "flex h-9 items-center overflow-hidden rounded-lg border transition-colors duration-150 ease-[var(--ease-foliet)]",
                isAnnotatorActive
                  ? "border-[var(--accent-brand)] bg-card text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-[var(--hairline-strong)]",
              )}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (activePreset) onTogglePreset(activePreset.id);
                      }}
                      className="h-full gap-2 rounded-none px-3 text-xs hover:bg-accent/60"
                    />
                  }
                >
                  {activePreset && !isUtilityTool(activePreset.toolType) && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border"
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
                      "max-w-36 truncate text-xs",
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
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {activePreset
                    ? `${activePreset.label} (${activePreset.shortcut.toUpperCase()})`
                    : "Annotation tools"}
                </TooltipContent>
              </Tooltip>

              <Separator orientation="vertical" className="h-5" />

              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Choose annotation tool"
                    className={cn(
                      "h-full w-9 rounded-none hover:bg-accent/60",
                      dropdownOpen
                        ? "text-[var(--accent-brand)]"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  />
                }
              >
                <ChevronDown
                  size={18}
                  strokeWidth={1.5}
                  className={cn(
                    "transition-transform duration-150 ease-[var(--ease-foliet)]",
                    dropdownOpen && "rotate-180",
                  )}
                />
              </DropdownMenuTrigger>
            </div>

            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-64 rounded-xl border-border bg-card p-1.5 shadow-[var(--shadow-float)]"
            >
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Annotation tools
              </div>

              <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                {presets.map((preset) => {
                  const isCurrentlyActive =
                    activeState.activePresetId === preset.id;
                  const isLastSelected = activePreset?.id === preset.id;
                  const utility = isUtilityTool(preset.toolType);

                  return (
                    <DropdownMenuItem
                      key={preset.id}
                      onClick={() => {
                        setSelectedPresetId(preset.id);
                        onTogglePreset(preset.id);
                      }}
                      className={cn(
                        "flex h-9 cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                        isCurrentlyActive
                          ? "bg-accent font-medium text-foreground"
                          : isLastSelected
                            ? "bg-accent/50 text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                          {!utility && (
                            <span
                              className="h-2.5 w-2.5 rounded-full ring-1 ring-border"
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
                    </DropdownMenuItem>
                  );
                })}
              </div>

              <DropdownMenuSeparator className="my-1" />

              <DropdownMenuItem
                onClick={() => setCustomizerOpen(true)}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors duration-150 ease-[var(--ease-foliet)]"
              >
                <SlidersHorizontal size={18} strokeWidth={1.5} />
                <span>Customize tools</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
    </TooltipProvider>
  );
}
