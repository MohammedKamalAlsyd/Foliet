/**
 * Foliet - PDF Text Selection Action Bar Popover
 *
 * Appears when non-empty text is selected in Select mode.
 * Anchored via Floating UI virtual reference to the live selection Range
 * so it tracks scroll/zoom and flips cleanly near viewport edges.
 */

import React, { useLayoutEffect, useState } from "react";
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
import { Globe, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AiMascot } from "@/components/ai/AiMascot";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useDocumentStore } from "@/stores/documentStore";
import { cn } from "@/lib/utils";

export interface SelectionActionBarProps {
  selectedText: string;
  pageNumber: number;
  anchorRect: DOMRect;
  selectionRange?: Range | null;
  onClose: () => void;
  docTitle?: string;
  docId?: string;
}

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  selectedText,
  pageNumber,
  anchorRect,
  selectionRange,
  onClose,
  docTitle,
  docId,
}) => {
  const [isHoveringLio, setIsHoveringLio] = useState(false);

  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const effectiveDocTitle = docTitle ?? activeDoc?.title ?? "Document";
  const effectiveDocId = docId ?? activeDoc?.id ?? "";

  const { refs, floatingStyles, context, update } = useFloating({
    open: true,
    onOpenChange: (nextOpen) => {
      if (!nextOpen) onClose();
    },
    placement: "top",
    strategy: "fixed",
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context, {
    escapeKey: true,
    outsidePress: true,
  });
  const { getFloatingProps } = useInteractions([dismiss]);

  useLayoutEffect(() => {
    const getLiveRange = (): Range | null => {
      if (selectionRange?.startContainer?.isConnected) {
        return selectionRange;
      }
      const sel = typeof window !== "undefined" ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        return sel.getRangeAt(0);
      }
      return null;
    };

    const initialRange = getLiveRange();
    const containerNode = initialRange?.commonAncestorContainer;
    const contextElement =
      containerNode instanceof Element
        ? containerNode
        : (containerNode?.parentElement ?? undefined);

    const virtualEl: VirtualElement = {
      getBoundingClientRect: () => {
        const liveRange = getLiveRange();
        if (liveRange) {
          const liveRect = liveRange.getBoundingClientRect();
          if (liveRect.width > 0 || liveRect.height > 0) {
            return liveRect;
          }
        }
        return anchorRect;
      },
      getClientRects: () => {
        const liveRange = getLiveRange();
        if (liveRange) {
          const rects = liveRange.getClientRects();
          if (rects.length > 0) return rects;
        }
        return [anchorRect] as unknown as DOMRectList;
      },
      contextElement,
    };

    refs.setReference(virtualEl);
    update();

    const pageEl = contextElement?.closest("[data-foliet-page]");
    if (!pageEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(pageEl);
    return () => observer.disconnect();
  }, [refs, update, selectionRange, anchorRect]);

  const handleSearchWeb = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const query = encodeURIComponent(selectedText.trim().slice(0, 300));
    const url = `https://www.google.com/search?q=${query}`;
    try {
      await openUrl(url);
    } catch (err) {
      console.warn(
        "SelectionActionBar: openUrl failed, using window.open fallback:",
        err,
      );
      window.open(url, "_blank");
    }
    onClose();
  };

  const handleAskLio = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    useAiStudioStore.getState().askAboutSelection({
      text: selectedText,
      pageNumber,
      docTitle: effectiveDocTitle,
      docId: effectiveDocId,
    });
    onClose();
  };

  if (typeof document === "undefined") return null;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{ ...floatingStyles, zIndex: 9999 }}
        {...getFloatingProps()}
      >
        <div
          role="toolbar"
          aria-label="Text selection actions"
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            "animate-in fade-in zoom-in-95 duration-150 ease-out",
            "flex items-center gap-1 rounded-full border border-border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur-md",
          )}
        >
          {/* Action 1: Search Web */}
          <button
            type="button"
            onClick={handleSearchWeb}
            title="Search Google for selected text in default browser"
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground/90 transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <Globe
              size={13}
              strokeWidth={1.75}
              className="text-muted-foreground"
            />
            <span>Search Web</span>
          </button>

          {/* Subtle hairline separator */}
          <div className="h-3.5 w-px bg-border/80" aria-hidden="true" />

          {/* Action 2: Ask Lio */}
          <button
            type="button"
            onClick={handleAskLio}
            onMouseEnter={() => setIsHoveringLio(true)}
            onMouseLeave={() => setIsHoveringLio(false)}
            title="Open AI Studio and query Lio with this passage"
            className="group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-[var(--accent-brand,#2563EB)]/10 hover:text-[var(--accent-brand,#2563EB)] active:scale-95"
          >
            <AiMascot
              size={16}
              state={isHoveringLio ? "happy" : "curious"}
              interactive={false}
              className="shrink-0 transition-transform group-hover:scale-110"
            />
            <span>Ask Lio</span>
          </button>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Dismiss"
            className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X size={11} strokeWidth={2} />
          </button>
        </div>
      </div>
    </FloatingPortal>
  );
};
