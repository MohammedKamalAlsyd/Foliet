import { useEffect, useRef, useState } from "react";
import { Check, Pipette, Plus, RotateCcw, Trash2 } from "lucide-react";
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
  type ToolType,
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

const SHORTCUT_CANDIDATES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "q",
  "w",
  "r",
  "t",
  "y",
  "u",
  "i",
  "o",
  "p",
  "s",
  "d",
  "f",
  "g",
  "h",
  "j",
  "k",
  "l",
  "z",
  "x",
  "c",
  "b",
  "n",
  "m",
];

const CUSTOMIZABLE_TOOL_TYPES: { type: ToolType; label: string }[] = [
  { type: "highlight", label: "Highlight" },
  { type: "underline", label: "Underline" },
  { type: "strikethrough", label: "Strike" },
  { type: "popup_note", label: "Note" },
  { type: "freehand_write", label: "Pen" },
];

function isLightHex(hex: string): boolean {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62;
}

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return withHash.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    const [, r, g, b] = withHash;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

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
  const [hexDraft, setHexDraft] = useState("");

  const selectNewestOnAddRef = useRef(false);
  const prevLengthRef = useRef(presets.length);
  const colorInputRef = useRef<HTMLInputElement>(null);

  const activePreset = presets.find((p) => p.id === selectedId) ?? presets[0];

  useEffect(() => {
    if (
      selectNewestOnAddRef.current &&
      presets.length > prevLengthRef.current
    ) {
      const newest = presets[presets.length - 1];
      if (newest) setSelectedId(newest.id);
      selectNewestOnAddRef.current = false;
    } else if (!presets.some((p) => p.id === selectedId) && presets[0]) {
      setSelectedId(presets[0].id);
    }
    prevLengthRef.current = presets.length;
  }, [presets, selectedId]);

  useEffect(() => {
    if (activePreset) {
      setHexDraft(activePreset.color.toUpperCase());
    }
  }, [activePreset?.id, activePreset?.color]);

  useEffect(() => {
    if (!recordingKey || !activePreset) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key.toLowerCase();
      setRecordingKey(false);

      if (key === "escape" || IGNORED_KEYS.has(key) || key.length !== 1) return;

      if (key === "v") {
        setConflict('Key "V" is reserved for text selection');
        return;
      }

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

  const handleAddCustomPreset = async () => {
    const used = new Set(presets.map((p) => p.shortcut.toLowerCase()));
    const nextKey =
      SHORTCUT_CANDIDATES.find((k) => !used.has(k)) ?? String(presets.length);

    selectNewestOnAddRef.current = true;
    setRecordingKey(false);
    setConflict(null);

    await onAddPreset({
      toolType: "highlight",
      label: "Custom highlight",
      shortcut: nextKey,
      color: "#B44327",
    });
  };

  const handleHexChange = (val: string) => {
    setHexDraft(val);
    if (!activePreset) return;
    const trimmed = val.trim();
    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (/^#[0-9a-fA-F]{6}$/.test(withHash)) {
      onUpdatePreset({ ...activePreset, color: withHash.toUpperCase() });
    }
  };

  const commitHexDraft = () => {
    if (!activePreset) return;
    const normalized = normalizeHex(hexDraft);
    if (normalized) {
      setHexDraft(normalized);
      if (normalized !== activePreset.color.toUpperCase()) {
        onUpdatePreset({ ...activePreset, color: normalized });
      }
    } else {
      setHexDraft(activePreset.color.toUpperCase());
    }
  };

  const isCustomColor =
    activePreset &&
    !PRESET_COLORS.some(
      (c) => c.hex.toLowerCase() === activePreset.color.toLowerCase(),
    );

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

        <div className="grid h-[420px] grid-cols-[220px_1fr] divide-x divide-border">
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
                onClick={handleAddCustomPreset}
                className="h-7 gap-1 px-2 text-xs text-foreground"
              >
                <Plus size={16} strokeWidth={1.5} />
                <span>Add</span>
              </Button>
            </div>

            {presets.map((preset) => {
              const selected = activePreset?.id === preset.id;
              const utility = isUtilityTool(preset.toolType);
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
                    "h-8 w-full justify-between px-2.5 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                    selected
                      ? "border border-[var(--accent-brand)] bg-accent font-medium text-foreground"
                      : "border border-transparent font-normal text-muted-foreground hover:text-foreground",
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

                {!isUtilityTool(activePreset.toolType) && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Tool type
                    </label>
                    <div className="grid grid-cols-5 gap-1">
                      {CUSTOMIZABLE_TOOL_TYPES.map(({ type, label }) => {
                        const selected = activePreset.toolType === type;
                        return (
                          <button
                            key={type}
                            type="button"
                            title={label}
                            onClick={() =>
                              onUpdatePreset({
                                ...activePreset,
                                toolType: type,
                                strokeWidth:
                                  type === "freehand_write"
                                    ? (activePreset.strokeWidth ?? 2)
                                    : activePreset.strokeWidth,
                                underlineStyle:
                                  type === "underline"
                                    ? (activePreset.underlineStyle ?? "solid")
                                    : activePreset.underlineStyle,
                              })
                            }
                            className={cn(
                              "flex h-8 cursor-pointer items-center justify-center rounded-md border text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                              selected
                                ? "border-[var(--accent-brand)] bg-accent text-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            )}
                          >
                            <ToolIcon type={type} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Shortcut
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConflict(null);
                      setRecordingKey(true);
                    }}
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
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-muted-foreground">
                      Ink color
                    </label>

                    {/* Curated swatches + Free color picker */}
                    <div className="grid grid-cols-7 gap-2">
                      {PRESET_COLORS.map((c) => {
                        const selected =
                          activePreset.color.toLowerCase() ===
                          c.hex.toLowerCase();
                        return (
                          <button
                            key={c.hex}
                            type="button"
                            aria-label={c.name}
                            title={c.name}
                            onClick={() => {
                              setHexDraft(c.hex.toUpperCase());
                              onUpdatePreset({ ...activePreset, color: c.hex });
                            }}
                            style={{ backgroundColor: c.hex }}
                            className="flex h-8 cursor-pointer items-center justify-center rounded-md border border-black/15 transition-transform duration-150 ease-[var(--ease-foliet)] active:scale-[0.97]"
                          >
                            {selected && (
                              <Check
                                size={16}
                                strokeWidth={1.75}
                                className={
                                  isLightHex(c.hex)
                                    ? "text-neutral-900"
                                    : "text-white"
                                }
                              />
                            )}
                          </button>
                        );
                      })}

                      {/* Free native color picker swatch */}
                      <button
                        type="button"
                        aria-label="Pick custom color"
                        title="Pick any color"
                        onClick={() => colorInputRef.current?.click()}
                        style={
                          isCustomColor
                            ? { backgroundColor: activePreset.color }
                            : undefined
                        }
                        className={cn(
                          "relative flex h-8 cursor-pointer items-center justify-center rounded-md border transition-colors duration-150 ease-[var(--ease-foliet)] active:scale-[0.97]",
                          isCustomColor
                            ? "border-[var(--accent-brand)]"
                            : "border-border bg-muted text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Pipette
                          size={16}
                          strokeWidth={1.5}
                          className={cn(
                            isCustomColor &&
                              (isLightHex(activePreset.color)
                                ? "text-neutral-900"
                                : "text-white"),
                          )}
                        />
                        <input
                          ref={colorInputRef}
                          type="color"
                          aria-label="Custom ink color picker"
                          value={normalizeHex(activePreset.color) ?? "#B44327"}
                          onChange={(e) => {
                            const nextHex = e.target.value.toUpperCase();
                            setHexDraft(nextHex);
                            onUpdatePreset({
                              ...activePreset,
                              color: nextHex,
                            });
                          }}
                          className="sr-only"
                        />
                      </button>
                    </div>

                    {/* Editable hex input */}
                    <div className="flex items-center gap-2">
                      <span
                        className="h-8 w-8 shrink-0 rounded-md border border-border"
                        style={{ backgroundColor: activePreset.color }}
                      />
                      <Input
                        value={hexDraft}
                        onChange={(e) => handleHexChange(e.target.value)}
                        onBlur={commitHexDraft}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitHexDraft();
                          }
                        }}
                        maxLength={7}
                        spellCheck={false}
                        aria-label="Hex color code"
                        placeholder="#B44327"
                        className="h-8 font-mono text-xs uppercase tabular-nums"
                      />
                    </div>
                  </div>
                )}

                {activePreset.toolType === "freehand_write" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      Pen thickness
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
                          className={cn(
                            "h-8 font-mono text-xs tabular-nums",
                            activePreset.strokeWidth === w &&
                              "border-[var(--accent-brand)]",
                          )}
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
                          className={cn(
                            "h-8 text-xs capitalize",
                            activePreset.underlineStyle === style &&
                              "border-[var(--accent-brand)]",
                          )}
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
                  className="mt-4 h-8 justify-center gap-2 text-xs text-destructive hover:text-destructive"
                >
                  <Trash2 size={16} strokeWidth={1.5} />
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
            <RotateCcw size={16} strokeWidth={1.5} />
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
