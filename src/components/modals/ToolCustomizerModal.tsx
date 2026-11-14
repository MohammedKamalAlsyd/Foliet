import { useEffect, useState } from "react";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ToolIcon } from "@/components/viewer/PdfToolbar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { PRESET_COLORS } from "@/constants/tools";
import { cn } from "@/lib/utils";
import {
  type ToolPreset,
  type UnderlineStyle,
  isUtilityTool,
} from "@/types/tools";

interface ToolCustomizerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: ToolPreset[];
  onUpdatePreset: (preset: ToolPreset) => Promise<void>;
  onAddPreset: (preset: Omit<ToolPreset, "id">) => Promise<void>;
  onRemovePreset: (id: string) => Promise<void>;
  onResetPresets: () => Promise<void>;
}

const IGNORED_KEYS = new Set([
  "escape",
  "control",
  "alt",
  "shift",
  "meta",
  "tab",
  " ",
]);

export function ToolCustomizerModal({
  open,
  onOpenChange,
  presets,
  onUpdatePreset,
  onAddPreset,
  onRemovePreset,
  onResetPresets,
}: ToolCustomizerModalProps) {
  const [selectedId, setSelectedId] = useState(presets[0]?.id ?? "");
  const [recordingKey, setRecordingKey] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const activePreset = presets.find((p) => p.id === selectedId) ?? presets[0];

  useEffect(() => {
    if (!recordingKey || !activePreset) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      setRecordingKey(false);

      if (IGNORED_KEYS.has(key)) return;

      const collision = presets.find(
        (p) => p.shortcut.toLowerCase() === key && p.id !== activePreset.id,
      );
      if (collision) {
        setConflict(
          `Key "${key.toUpperCase()}" is assigned to ${collision.label}`,
        );
        return;
      }

      setConflict(null);
      onUpdatePreset({ ...activePreset, shortcut: key });
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recordingKey, activePreset, presets, onUpdatePreset]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setRecordingKey(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center justify-between text-sm font-medium">
            <span>Customize tools</span>
            <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
              {presets.length} tools
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid h-96 grid-cols-2 divide-x divide-border">
          {/* Left: Preset list */}
          <div className="flex flex-col gap-1 overflow-y-auto p-3">
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-xs font-medium text-muted-foreground">
                Presets
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  onAddPreset({
                    toolType: "highlight",
                    label: "Custom highlight",
                    shortcut: String(presets.length + 1),
                    color: "#B44327",
                  })
                }
                className="h-7 gap-1 px-2 text-xs text-foreground"
              >
                <Plus size={14} strokeWidth={1.5} />
                <span>Add</span>
              </Button>
            </div>

            {presets.map((preset) => {
              const selected = activePreset?.id === preset.id;
              return (
                <Button
                  key={preset.id}
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSelectedId(preset.id);
                    setRecordingKey(false);
                    setConflict(null);
                  }}
                  className={cn(
                    "h-9 w-full justify-between px-2.5 text-xs",
                    selected
                      ? "border border-[var(--accent-brand)] bg-accent font-medium text-foreground"
                      : "font-normal text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: isUtilityTool(preset.toolType)
                          ? "transparent"
                          : preset.color,
                      }}
                    />
                    <ToolIcon type={preset.toolType} />
                    <span className="truncate">{preset.label}</span>
                  </span>
                  <kbd className="uppercase">{preset.shortcut}</kbd>
                </Button>
              );
            })}
          </div>

          {/* Right: Selected preset editor */}
          {activePreset && (
            <div className="flex flex-col justify-between overflow-y-auto p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Label
                  </label>
                  <Input
                    value={activePreset.label}
                    onChange={(e) =>
                      onUpdatePreset({ ...activePreset, label: e.target.value })
                    }
                    className="h-8 text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Shortcut
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRecordingKey(true)}
                    className={cn(
                      "h-8 justify-center font-mono text-xs",
                      recordingKey &&
                        "border-[var(--accent-brand)] text-[var(--accent-brand)]",
                    )}
                  >
                    {recordingKey
                      ? "Press a single key"
                      : `Key "${activePreset.shortcut.toUpperCase()}"`}
                  </Button>
                  {conflict && (
                    <p className="text-xs text-destructive">{conflict}</p>
                  )}
                </div>

                {!isUtilityTool(activePreset.toolType) && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Ink color
                    </label>
                    <div className="grid grid-cols-6 gap-2">
                      {PRESET_COLORS.map((c) => {
                        const selected =
                          activePreset.color.toLowerCase() ===
                          c.hex.toLowerCase();
                        return (
                          <button
                            key={c.hex}
                            type="button"
                            aria-label={c.name}
                            onClick={() =>
                              onUpdatePreset({ ...activePreset, color: c.hex })
                            }
                            style={{ backgroundColor: c.hex }}
                            className="flex h-7 cursor-pointer items-center justify-center rounded-md border border-border transition-transform duration-150 ease-[var(--ease-foliet)] active:scale-[0.97]"
                          >
                            {selected && (
                              <Check
                                size={14}
                                strokeWidth={2}
                                className="text-black"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activePreset.toolType === "freehand_write" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Stroke width
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[1.5, 3, 5].map((w) => (
                        <Button
                          key={w}
                          type="button"
                          variant={
                            activePreset.strokeWidth === w
                              ? "secondary"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            onUpdatePreset({ ...activePreset, strokeWidth: w })
                          }
                          className="h-8 font-mono text-xs tabular-nums"
                        >
                          {w}px
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {activePreset.toolType === "underline" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Underline style
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        ["solid", "squiggle", "dashed"] as UnderlineStyle[]
                      ).map((style) => (
                        <Button
                          key={style}
                          type="button"
                          variant={
                            activePreset.underlineStyle === style
                              ? "secondary"
                              : "outline"
                          }
                          size="sm"
                          onClick={() =>
                            onUpdatePreset({
                              ...activePreset,
                              underlineStyle: style,
                            })
                          }
                          className="h-8 text-xs capitalize"
                        >
                          {style}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {activePreset.isCustom && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemovePreset(activePreset.id)}
                  className="h-8 justify-center gap-2 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                  <span>Delete preset</span>
                </Button>
              )}
            </div>
          )}
        </div>

        <Separator />

        <DialogFooter className="flex-row items-center justify-between px-5 py-3 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onResetPresets}
            className="h-8 gap-2 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            <RotateCcw size={14} strokeWidth={1.5} />
            <span>Reset defaults</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 px-4 text-xs"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
