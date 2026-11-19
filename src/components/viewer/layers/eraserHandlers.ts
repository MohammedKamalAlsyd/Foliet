import type React from "react";

export interface EraserPointerHandlers {
  onPointerDown?: React.PointerEventHandler;
  onPointerEnter?: React.PointerEventHandler;
}

const NOOP_HANDLERS: EraserPointerHandlers = {};

/**
 * Shared pointer-event handler pair for erasing PDF overlay annotations on
 * click (`button === 0`) or drag-sweep (`buttons === 1`).
 */
export function getEraserPointerHandlers(
  isEraser: boolean,
  annotationId: string,
  onDeleteAnnotation: (id: string) => void,
): EraserPointerHandlers {
  if (!isEraser) return NOOP_HANDLERS;
  return {
    onPointerDown: (e) => {
      if (e.button === 0) {
        e.stopPropagation();
        onDeleteAnnotation(annotationId);
      }
    },
    onPointerEnter: (e) => {
      if (e.buttons === 1) {
        onDeleteAnnotation(annotationId);
      }
    },
  };
}
