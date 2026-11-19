import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  type VirtualElement,
} from "@floating-ui/react";
import { useDebouncedCallback } from "use-debounce";
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
  const isOpen = Boolean(note && anchorPos);

  const [draftComment, setDraftComment] = useState(note?.comment ?? "");
  const prevNoteIdRef = useRef<string | null>(note?.id ?? null);
  const lastNoteCommentRef = useRef<string>(note?.comment ?? "");
  const onUpdateNoteRef = useRef(onUpdateNote);
  onUpdateNoteRef.current = onUpdateNote;

  const debouncedCommit = useDebouncedCallback(
    (targetNote: NoteAnnotation, comment: string) => {
      if (targetNote.comment !== comment) {
        onUpdateNoteRef.current({ ...targetNote, comment });
      }
    },
    300,
  );

  useEffect(() => {
    const nextId = note?.id ?? null;
    const nextComment = note?.comment ?? "";

    if (prevNoteIdRef.current !== nextId) {
      if (prevNoteIdRef.current !== null) {
        debouncedCommit.flush();
      }
      prevNoteIdRef.current = nextId;
      lastNoteCommentRef.current = nextComment;
      setDraftComment(nextComment);
      return;
    }

    if (nextId !== null && nextComment !== lastNoteCommentRef.current) {
      lastNoteCommentRef.current = nextComment;
      if (!debouncedCommit.isPending()) {
        setDraftComment(nextComment);
      }
    }
  }, [note?.id, note?.comment, debouncedCommit]);

  useEffect(() => {
    return () => {
      debouncedCommit.flush();
    };
  }, [debouncedCommit]);

  const handleClose = useCallback(() => {
    debouncedCommit.flush();
    onClose();
  }, [debouncedCommit, onClose]);

  const { refs, floatingStyles, context, update } = useFloating({
    open: isOpen,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) handleClose();
    },
    placement: "right-start",
    strategy: "fixed",
    middleware: [offset(12), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context, {
    escapeKey: true,
    outsidePress: true,
  });
  const { getFloatingProps } = useInteractions([dismiss]);

  useLayoutEffect(() => {
    if (!anchorPos) return;
    const virtualEl: VirtualElement = {
      getBoundingClientRect: () => ({
        width: 0,
        height: 0,
        x: anchorPos.x,
        y: anchorPos.y,
        top: anchorPos.y,
        left: anchorPos.x,
        right: anchorPos.x,
        bottom: anchorPos.y,
      }),
    };
    refs.setReference(virtualEl);
    update();
  }, [refs, update, anchorPos]);

  if (!note || !anchorPos) return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, width: 288, zIndex: 50 }}
        {...getFloatingProps()}
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-float)]"
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
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                debouncedCommit.cancel();
                onDeleteNote(note.id);
                onClose();
              }}
              aria-label="Delete note"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={14} strokeWidth={1.5} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClose}
              aria-label="Close note"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
            >
              <X size={14} strokeWidth={1.5} />
            </Button>
          </div>
        </div>

        <Separator />

        <textarea
          key={note.id}
          autoFocus
          value={draftComment}
          onChange={(e) => {
            const next = e.target.value;
            setDraftComment(next);
            debouncedCommit(note, next);
          }}
          onBlur={() => debouncedCommit.flush()}
          placeholder="Write a note"
          className="h-36 w-full resize-none bg-transparent p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
    </FloatingPortal>
  );
}
