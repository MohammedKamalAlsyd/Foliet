import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { NoteAnnotation } from "@/types/annotations";

interface NoteEditorPortalProps {
  note: NoteAnnotation | null;
  anchorPos: { x: number; y: number } | null;
  onClose: () => void;
  onUpdateNote: (updated: NoteAnnotation) => void;
  onDeleteNote: (id: string) => void;
}

export function NoteEditorPortal({
  note,
  anchorPos,
  onClose,
  onUpdateNote,
  onDeleteNote,
}: NoteEditorPortalProps) {
  useEffect(() => {
    if (!note) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [note, onClose]);

  if (!note || !anchorPos) return null;

  const width = 288;
  const height = 216;
  const left = Math.min(
    Math.max(12, anchorPos.x + 12),
    window.innerWidth - width - 12,
  );
  const top = Math.min(
    Math.max(12, anchorPos.y - 12),
    window.innerHeight - height - 12,
  );

  return createPortal(
    <div
      style={{ left, top, width }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-float)]"
    >
      <div className="flex h-9 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: note.color }}
          />
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            Page {note.pageNumber}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onDeleteNote(note.id)}
            aria-label="Delete note"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close note"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
          >
            <X size={14} strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <Separator />

      <textarea
        autoFocus
        value={note.comment}
        onChange={(e) => onUpdateNote({ ...note, comment: e.target.value })}
        placeholder="Write a note"
        className="h-36 w-full resize-none bg-transparent p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
    </div>,
    document.body,
  );
}
