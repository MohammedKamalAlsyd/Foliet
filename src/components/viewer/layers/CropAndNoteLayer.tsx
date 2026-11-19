import { ImagePlus, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { insertFigureIntoSummary } from "@/services/figureCropper";
import { useDocumentStore } from "@/stores/documentStore";
import type { CropAnnotation, NoteAnnotation } from "@/types/annotations";

export interface CropDragRect {
  startX: number;
  startY: number;
  currX: number;
  currY: number;
}

export interface QuickInsertCropState {
  crop: CropAnnotation;
  x: number;
  y: number;
}

interface CropAndNoteLayerProps {
  noteAnnotations: NoteAnnotation[];
  cropRect: CropDragRect | null;
  quickInsertCrop: QuickInsertCropState | null;
  isSummaryWorkspaceOpen: boolean;
  isEraser: boolean;
  onDeleteAnnotation: (id: string) => void;
  onNoteClick: (note: NoteAnnotation, anchor: { x: number; y: number }) => void;
  onDismissQuickInsert: () => void;
}

export function CropAndNoteLayer({
  noteAnnotations,
  cropRect,
  quickInsertCrop,
  isSummaryWorkspaceOpen,
  isEraser,
  onDeleteAnnotation,
  onNoteClick,
  onDismissQuickInsert,
}: CropAndNoteLayerProps) {
  return (
    <>
      {cropRect && (
        <div
          className="pointer-events-none absolute z-30 border border-[var(--accent-brand)] bg-[var(--selection-bg)]"
          style={{
            left: `${Math.min(cropRect.startX, cropRect.currX) * 100}%`,
            top: `${Math.min(cropRect.startY, cropRect.currY) * 100}%`,
            width: `${Math.abs(cropRect.currX - cropRect.startX) * 100}%`,
            height: `${Math.abs(cropRect.currY - cropRect.startY) * 100}%`,
          }}
        />
      )}

      {quickInsertCrop && isSummaryWorkspaceOpen && (
        <div
          style={{
            left: `${quickInsertCrop.x * 100}%`,
            top: `${quickInsertCrop.y * 100}%`,
          }}
          className="absolute z-40 mt-1.5 -translate-x-1/2 flex items-center gap-1 rounded-full border border-border bg-card/95 px-2.5 py-1 text-xs shadow-lg backdrop-blur-md"
        >
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const docId = useDocumentStore.getState().activeDoc?.id;
              await insertFigureIntoSummary(quickInsertCrop.crop, docId);
              onDismissQuickInsert();
            }}
            className="inline-flex items-center gap-1.5 font-medium text-[var(--accent-brand,#2563EB)] hover:opacity-85 cursor-pointer"
          >
            <ImagePlus size={13} strokeWidth={1.75} />
            <span>Insert in Summary</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismissQuickInsert();
            }}
            aria-label="Dismiss"
            className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {noteAnnotations.map((note) => (
        <button
          key={note.id}
          type="button"
          onPointerDown={(e) => {
            if (isEraser && e.button === 0) {
              e.stopPropagation();
              onDeleteAnnotation(note.id);
            }
          }}
          onPointerEnter={(e) => {
            if (isEraser && e.buttons === 1) {
              onDeleteAnnotation(note.id);
            }
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (!isEraser) onNoteClick(note, { x: e.clientX, y: e.clientY });
          }}
          title={note.comment || "Open note"}
          style={{
            left: `${note.x * 100}%`,
            top: `${note.y * 100}%`,
            backgroundColor: note.color,
          }}
          className={cn(
            "absolute z-30 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border border-black/15 text-black shadow-[var(--shadow-sm)] transition-colors duration-150 ease-[var(--ease-foliet)]",
            isEraser ? "cursor-[inherit]" : "cursor-pointer",
          )}
        >
          <MessageSquare size={14} strokeWidth={1.5} />
        </button>
      ))}
    </>
  );
}
