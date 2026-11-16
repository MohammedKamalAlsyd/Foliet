/**
 * Foliet - PDF Text Selection Action Bar Popover
 *
 * Appears when non-empty text is selected in Select mode.
 * Anchored above/below the selection bounds with viewport clamping.
 * Features quick web search and contextual query handoff to Lio.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AiMascot } from "@/components/ai/AiMascot";
import { useAiStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { cn } from "@/lib/utils";

export interface SelectionActionBarProps {
    selectedText: string;
    pageNumber: number;
    anchorRect: DOMRect;
    onClose: () => void;
    docTitle?: string;
    docId?: string;
}

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
    selectedText,
    pageNumber,
    anchorRect,
    onClose,
    docTitle,
    docId,
}) => {
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const [isHoveringLio, setIsHoveringLio] = useState(false);

    const activeDoc = useDocumentStore((s) => s.activeDoc);
    const effectiveDocTitle = docTitle ?? activeDoc?.title ?? "Document";
    const effectiveDocId = docId ?? activeDoc?.id ?? "";

    // Close on Escape or click outside
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        const handlePointerDown = (e: PointerEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("pointerdown", handlePointerDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [onClose]);

    // Viewport-clamped positioning
    const popoverWidth = 240;
    const popoverHeight = 40;
    const margin = 12;

    const targetX = anchorRect.left + anchorRect.width / 2;
    const clampedX = Math.max(
        popoverWidth / 2 + margin,
        Math.min(window.innerWidth - popoverWidth / 2 - margin, targetX)
    );

    // If too close to viewport top, show below selection rect
    const placeBelow = anchorRect.top < popoverHeight + margin + 12;
    const clampedY = placeBelow ? anchorRect.bottom + 8 : anchorRect.top - 8;

    const handleSearchWeb = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const query = encodeURIComponent(selectedText.trim().slice(0, 300));
        const url = `https://www.google.com/search?q=${query}`;
        try {
            await openUrl(url);
        } catch (err) {
            console.warn("SelectionActionBar: openUrl failed, using window.open fallback:", err);
            window.open(url, "_blank");
        }
        onClose();
    };

    const handleAskLio = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        useAiStore.getState().askAboutSelection({
            text: selectedText,
            pageNumber,
            docTitle: effectiveDocTitle,
            docId: effectiveDocId,
        });
        onClose();
    };

    if (typeof document === "undefined") return null;

    return createPortal(
        <div
            ref={popoverRef}
            role="toolbar"
            aria-label="Text selection actions"
            style={{
                position: "fixed",
                left: `${clampedX}px`,
                top: `${clampedY}px`,
                transform: placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
                zIndex: 9999,
            }}
            className={cn(
                "animate-in fade-in zoom-in-95 duration-150 ease-out",
                "flex items-center gap-1 rounded-full border border-border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur-md"
            )}
        >
            {/* Action 1: Search Web */}
            <button
                type="button"
                onClick={handleSearchWeb}
                title="Search Google for selected text in default browser"
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-foreground/90 transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
                <Globe size={13} strokeWidth={1.75} className="text-muted-foreground" />
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
        </div>,
        document.body
    );
};
