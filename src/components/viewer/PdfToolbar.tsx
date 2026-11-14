import { useState } from "react";
import {
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

export function ToolIcon({ type }: { type: ToolType }) {
  const props = { size: 16, strokeWidth: 1.5 };
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

  return (
    <>
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 select-none overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSetSelectMode}
            title="Select text (V)"
            className={cn(
              "h-8 gap-2 px-2.5 text-xs",
              activeState.toolType === "select"
                ? "border border-border bg-card text-foreground shadow-[var(--shadow-sm)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ToolIcon type="select" />
            <kbd className="hidden md:inline-flex">V</kbd>
          </Button>

          <Separator orientation="vertical" className="mx-1 h-4" />

          {presets.map((preset) => {
            const active = activeState.activePresetId === preset.id;
            return (
              <Button
                key={preset.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onTogglePreset(preset.id)}
                title={`${preset.label} (${preset.shortcut.toUpperCase()})`}
                className={cn(
                  "h-8 gap-2 px-2.5 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                  active
                    ? "border border-border bg-card text-foreground shadow-[var(--shadow-sm)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {!isUtilityTool(preset.toolType) && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: preset.color }}
                  />
                )}
                <ToolIcon type={preset.toolType} />
                <kbd className="hidden lg:inline-flex uppercase">
                  {preset.shortcut}
                </kbd>
              </Button>
            );
          })}

          {activeState.toolType === "freehand_write" && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <div className="flex items-center gap-1">
                {[1.5, 3, 5].map((w) => (
                  <Button
                    key={w}
                    type="button"
                    variant={
                      activeState.strokeWidth === w ? "secondary" : "ghost"
                    }
                    size="sm"
                    onClick={() => onSetStrokeWidth(w)}
                    className="h-7 px-2 font-mono text-xs tabular-nums"
                  >
                    {w}px
                  </Button>
                ))}
              </div>
            </>
          )}

          {activeState.toolType === "underline" && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              <div className="flex items-center gap-1">
                {(["solid", "squiggle", "dashed"] as UnderlineStyle[]).map(
                  (style) => (
                    <Button
                      key={style}
                      type="button"
                      variant={
                        activeState.underlineStyle === style
                          ? "secondary"
                          : "ghost"
                      }
                      size="sm"
                      onClick={() => onSetUnderlineStyle(style)}
                      className="h-7 px-2 text-xs capitalize"
                    >
                      {style}
                    </Button>
                  ),
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!canUndo}
            onClick={onUndo}
            aria-label="Undo"
            title="Undo"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
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
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
          >
            <Redo2 size={16} strokeWidth={1.5} />
          </Button>

          <Separator orientation="vertical" className="mx-1 h-4" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCustomizerOpen(true)}
            className="h-7 gap-2 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal size={16} strokeWidth={1.5} />
            <span className="hidden sm:inline">Customize</span>
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
