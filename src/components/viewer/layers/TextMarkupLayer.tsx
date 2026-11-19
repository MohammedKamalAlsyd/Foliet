import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { TextMarkupAnnotation } from "@/types/annotations";
import type { RagSearchResult } from "@/types/embedding";

interface TextMarkupLayerProps {
  textMarkups: TextMarkupAnnotation[];
  ragHighlight: RagSearchResult | null;
  isDimensionsSettled: boolean;
  isEraser: boolean;
  onDeleteAnnotation: (id: string) => void;
}

export function TextMarkupLayer({
  textMarkups,
  ragHighlight,
  isDimensionsSettled,
  isEraser,
  onDeleteAnnotation,
}: TextMarkupLayerProps) {
  const ragSpotlightRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledKeyRef = useRef<string | null>(null);

  const ragRects = ragHighlight?.rectSegments;
  const ragSpotlightScrollIdx = ragRects?.length
    ? Math.floor(ragRects.length / 2)
    : -1;
  const highlightKey =
    ragHighlight && ragRects?.length
      ? `${ragHighlight.chunkId}:${ragHighlight.pageNumber}:${ragRects.length}`
      : null;

  useEffect(() => {
    if (!highlightKey) {
      lastScrolledKeyRef.current = null;
      return;
    }
    if (!isDimensionsSettled || lastScrolledKeyRef.current === highlightKey) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const el = ragSpotlightRef.current;
      if (!el) return;

      lastScrolledKeyRef.current = highlightKey;

      const rect = el.getBoundingClientRect();
      const container = el.closest(".overflow-auto, .overflow-y-auto");
      const bounds = container
        ? container.getBoundingClientRect()
        : {
            top: 0,
            bottom: window.innerHeight,
            left: 0,
            right: window.innerWidth,
          };

      const isInViewport =
        rect.top >= bounds.top + 12 &&
        rect.bottom <= bounds.bottom - 12 &&
        rect.left >= bounds.left &&
        rect.right <= bounds.right;

      if (!isInViewport) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [highlightKey, isDimensionsSettled]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {ragRects?.map((seg, idx) => (
        <div
          key={`rag-spot-${ragHighlight?.chunkId ?? "chunk"}-${idx}`}
          ref={idx === ragSpotlightScrollIdx ? ragSpotlightRef : undefined}
          style={{
            left: `${seg.x * 100}%`,
            top: `${seg.y * 100}%`,
            width: `${seg.width * 100}%`,
            height: `${seg.height * 100}%`,
          }}
          className="absolute animate-pulse rounded-[2px] border-b-2 border-[var(--accent-brand,#2563EB)] bg-[var(--accent-brand,#2563EB)]/20"
        />
      ))}

      {textMarkups.map((annot) => (
        <div
          key={annot.id}
          className={cn(
            "pointer-events-none absolute inset-0",
            annot.toolType === "highlight" && "opacity-40 mix-blend-multiply",
          )}
        >
          {annot.rectSegments.map((seg, idx) => (
            <div
              key={`${annot.id}-${idx}`}
              onPointerDown={
                isEraser
                  ? (e) => {
                      if (e.button === 0) {
                        e.stopPropagation();
                        onDeleteAnnotation(annot.id);
                      }
                    }
                  : undefined
              }
              onPointerEnter={
                isEraser
                  ? (e) => {
                      if (e.buttons === 1) {
                        onDeleteAnnotation(annot.id);
                      }
                    }
                  : undefined
              }
              style={{
                left: `${seg.x * 100}%`,
                top: `${seg.y * 100}%`,
                width: `${seg.width * 100}%`,
                height: `${seg.height * 100}%`,
              }}
              className={cn(
                "absolute",
                isEraser &&
                  "pointer-events-auto cursor-[inherit] hover:opacity-60",
              )}
            >
              {annot.toolType === "highlight" && (
                <div
                  className="h-full w-full rounded-[2px]"
                  style={{ backgroundColor: annot.color }}
                />
              )}
              {annot.toolType === "strikethrough" && (
                <div
                  className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2"
                  style={{ backgroundColor: annot.color }}
                />
              )}
              {annot.toolType === "underline" &&
                (annot.underlineStyle === "squiggle" ? (
                  <svg
                    viewBox="0 0 100 8"
                    preserveAspectRatio="none"
                    className="absolute inset-x-0 bottom-0 h-[4px] w-full"
                  >
                    <path
                      d="M0 4 Q 6 0, 12 4 T 24 4 T 36 4 T 48 4 T 60 4 T 72 4 T 84 4 T 96 4 T 100 4"
                      fill="none"
                      stroke={annot.color}
                      strokeWidth="2"
                    />
                  </svg>
                ) : (
                  <div
                    className="absolute inset-x-0 bottom-0 h-0 border-b-[2px]"
                    style={{
                      borderColor: annot.color,
                      borderStyle:
                        annot.underlineStyle === "dashed" ? "dashed" : "solid",
                    }}
                  />
                ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
