import { memo, useMemo } from "react";
import { getStroke } from "perfect-freehand";
import { getEraserPointerHandlers } from "@/components/viewer/layers/eraserHandlers";
import type { InkAnnotation, Point } from "@/types/annotations";

interface InkLayerProps {
  inkAnnotations: InkAnnotation[];
  inkDraft: Point[] | null;
  activeColor: string;
  activeStrokeWidth: number;
  pageWidth: number;
  pageHeight: number;
  isEraser: boolean;
  onDeleteAnnotation: (id: string) => void;
}

function getSvgPathFromStroke(stroke: number[][]): string {
  if (stroke.length === 0) return "";
  if (stroke.length === 1) {
    const [x, y] = stroke[0];
    return `M ${x} ${y} a 0.5 0.5 0 1 0 0.001 0 Z`;
  }
  const d = stroke.reduce<Array<string | number>>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", stroke[0][0], stroke[0][1], "Q"],
  );
  d.push("Z");
  return d.join(" ");
}

function buildFreehandPath(
  points: Point[],
  strokeWidth: number,
  pageWidth: number,
  pageHeight: number,
  isComplete: boolean,
): string {
  if (points.length === 0) return "";
  const stroke = getStroke(
    points.map((p) => [p.x * pageWidth, p.y * pageHeight]),
    {
      size: Math.max(1.5, (strokeWidth || 2) * 1.6),
      thinning: 0.45,
      smoothing: 0.5,
      streamline: 0.45,
      simulatePressure: true,
      last: isComplete,
    },
  );
  return getSvgPathFromStroke(stroke);
}

interface SavedInkPathsProps {
  inkAnnotations: InkAnnotation[];
  safeWidth: number;
  safeHeight: number;
  isEraser: boolean;
  onDeleteAnnotation: (id: string) => void;
}

const SavedInkPaths = memo(function SavedInkPaths({
  inkAnnotations,
  safeWidth,
  safeHeight,
  isEraser,
  onDeleteAnnotation,
}: SavedInkPathsProps) {
  const savedPaths = useMemo(
    () =>
      inkAnnotations.map((annot) => ({
        annot,
        d: buildFreehandPath(
          annot.points,
          annot.strokeWidth,
          safeWidth,
          safeHeight,
          true,
        ),
      })),
    [inkAnnotations, safeWidth, safeHeight],
  );

  return (
    <>
      {savedPaths.map(({ annot, d }) => {
        if (!d) return null;
        return isEraser ? (
          <g
            key={annot.id}
            {...getEraserPointerHandlers(
              true,
              annot.id,
              onDeleteAnnotation,
            )}
            className="pointer-events-auto cursor-[inherit] hover:opacity-50"
          >
            <path d={d} fill={annot.color} stroke="none" />
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(10, (annot.strokeWidth || 2) * 3)}
            />
          </g>
        ) : (
          <path key={annot.id} d={d} fill={annot.color} stroke="none" />
        );
      })}
    </>
  );
});

interface DraftInkPathProps {
  inkDraft: Point[] | null;
  activeColor: string;
  activeStrokeWidth: number;
  safeWidth: number;
  safeHeight: number;
}

const DraftInkPath = memo(function DraftInkPath({
  inkDraft,
  activeColor,
  activeStrokeWidth,
  safeWidth,
  safeHeight,
}: DraftInkPathProps) {
  const draftPath = useMemo(() => {
    if (!inkDraft || inkDraft.length < 2) return "";
    return buildFreehandPath(
      inkDraft,
      activeStrokeWidth,
      safeWidth,
      safeHeight,
      false,
    );
  }, [inkDraft, activeStrokeWidth, safeWidth, safeHeight]);

  if (!draftPath) return null;
  return <path d={draftPath} fill={activeColor} stroke="none" />;
});

export const InkLayer = memo(function InkLayer({
  inkAnnotations,
  inkDraft,
  activeColor,
  activeStrokeWidth,
  pageWidth,
  pageHeight,
  isEraser,
  onDeleteAnnotation,
}: InkLayerProps) {
  const safeWidth = Math.max(1, pageWidth);
  const safeHeight = Math.max(1, pageHeight);

  return (
    <svg
      viewBox={`0 0 ${safeWidth} ${safeHeight}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
    >
      <SavedInkPaths
        inkAnnotations={inkAnnotations}
        safeWidth={safeWidth}
        safeHeight={safeHeight}
        isEraser={isEraser}
        onDeleteAnnotation={onDeleteAnnotation}
      />
      <DraftInkPath
        inkDraft={inkDraft}
        activeColor={activeColor}
        activeStrokeWidth={activeStrokeWidth}
        safeWidth={safeWidth}
        safeHeight={safeHeight}
      />
    </svg>
  );
});
