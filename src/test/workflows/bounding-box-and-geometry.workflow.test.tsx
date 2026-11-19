import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PdfPage } from "@/components/viewer/PdfPage";
import { CropAndNoteLayer } from "@/components/viewer/layers/CropAndNoteLayer";
import { InkLayer } from "@/components/viewer/layers/InkLayer";
import { TextMarkupLayer } from "@/components/viewer/layers/TextMarkupLayer";
import { mockRagBackend } from "@/test/fakes/mockTauri";
import {
  type NormalizedSpanLayout,
  extractNormalizedSpansFromPdfPage,
  mountMockPdfPageDom,
  setElementRect,
} from "@/test/helpers/domGeometry";
import {
  SAMPLE_1PAGE_PATH,
  SAMPLE_2PAGE_PATH,
  loadPdfFixture,
  readFixtureBytes,
} from "@/test/helpers/pdfFixtureLoader";
import type { InkAnnotation, TextMarkupAnnotation } from "@/types/annotations";
import type { Rect } from "@/types/common";
import {
  extractCaptionNearCropRect,
  extractPdfPageText,
  resolveDomTextRects,
  resolvePassageRects,
} from "@/utils/pdfDom";
import { mergeLineRects } from "@/utils/pdfGeometry";

function assertNormalizedRect(rect: Rect) {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(1 + 1e-6);
  expect(rect.y + rect.height).toBeLessThanOrEqual(1 + 1e-6);
}

describe("Bounding-box, coordinate geometry & real PDF fixture workflows", () => {
  const mountedContainers: HTMLElement[] = [];

  function createHost(): HTMLDivElement {
    const div = document.createElement("div");
    document.body.appendChild(div);
    mountedContainers.push(div);
    return div;
  }

  afterEach(() => {
    while (mountedContainers.length > 0) {
      mountedContainers.pop()?.remove();
    }
  });

  describe("Real PDF fixtures sanity check (pdfjs-dist)", () => {
    it("loads sample-1page.pdf with valid %PDF- bytes, numPages=1, viewport, and text", async () => {
      const raw = readFixtureBytes(SAMPLE_1PAGE_PATH);
      const header = new TextDecoder("ascii").decode(raw.subarray(0, 5));
      expect(header).toBe("%PDF-");

      const { pdfProxy, destroy } = await loadPdfFixture(SAMPLE_1PAGE_PATH);
      try {
        expect(pdfProxy.numPages).toBe(1);
        const page1 = await pdfProxy.getPage(1);
        const viewport = page1.getViewport({ scale: 1 });
        expect(viewport.width).toBeGreaterThan(0);
        expect(viewport.height).toBeGreaterThan(0);

        const text = await extractPdfPageText(pdfProxy, 1);
        expect(text).toContain("Hello, world!");
      } finally {
        await destroy();
      }
    });

    it("loads sample-2page.pdf with valid %PDF- bytes, numPages=2, Letter viewport, and distinct Page 1 vs Page 2 text", async () => {
      const raw = readFixtureBytes(SAMPLE_2PAGE_PATH);
      const header = new TextDecoder("ascii").decode(raw.subarray(0, 5));
      expect(header).toBe("%PDF-");

      const { pdfProxy, destroy } = await loadPdfFixture(SAMPLE_2PAGE_PATH);
      try {
        expect(pdfProxy.numPages).toBe(2);

        const page1 = await pdfProxy.getPage(1);
        const vp1 = page1.getViewport({ scale: 1 });
        expect(vp1.width).toBe(612);
        expect(vp1.height).toBe(792);

        const page2 = await pdfProxy.getPage(2);
        const vp2 = page2.getViewport({ scale: 1 });
        expect(vp2.width).toBe(612);
        expect(vp2.height).toBe(792);

        const text1 = await extractPdfPageText(pdfProxy, 1);
        const text2 = await extractPdfPageText(pdfProxy, 2);

        expect(text1).toContain("Neural Retrieval Systems");
        expect(text1).toContain("tokeniza-");
        expect(text2).toContain("Section 2: Experimental Architecture");
        expect(text2).toContain("Figure 1: Neural retrieval pipeline");
        expect(text1).not.toEqual(text2);
      } finally {
        await destroy();
      }
    });
  });

  describe("Line & column rect merging (mergeLineRects)", () => {
    it("merges adjacent word rects on the same line into a single minX..maxX rect", () => {
      const merged = mergeLineRects([
        { x: 0.1, y: 0.2, width: 0.12, height: 0.02 },
        { x: 0.224, y: 0.201, width: 0.15, height: 0.02 },
        { x: 0.378, y: 0.199, width: 0.1, height: 0.022 },
      ]);

      expect(merged).toHaveLength(1);
      expect(merged[0].x).toBeCloseTo(0.1, 4);
      expect(merged[0].y).toBeCloseTo(0.199, 4);
      expect(merged[0].x + merged[0].width).toBeCloseTo(0.478, 4);
      expect(merged[0].y + merged[0].height).toBeCloseTo(0.221, 4);
    });

    it("keeps rects on different lines separate", () => {
      const merged = mergeLineRects([
        { x: 0.1, y: 0.2, width: 0.5, height: 0.02 },
        { x: 0.1, y: 0.24, width: 0.45, height: 0.02 },
        { x: 0.1, y: 0.28, width: 0.3, height: 0.02 },
      ]);

      expect(merged).toHaveLength(3);
      expect(merged[0].y).toBeCloseTo(0.2, 4);
      expect(merged[1].y).toBeCloseTo(0.24, 4);
      expect(merged[2].y).toBeCloseTo(0.28, 4);
    });

    it("does NOT merge two-column rects at the same y separated by a column gutter", () => {
      const merged = mergeLineRects([
        { x: 0.11, y: 0.42, width: 0.33, height: 0.018 }, // left column ends at 0.44
        { x: 0.53, y: 0.42, width: 0.34, height: 0.018 }, // right column starts at 0.53 (0.09 gutter)
      ]);

      expect(merged).toHaveLength(2);
      expect(merged[0].x).toBeCloseTo(0.11, 4);
      expect(merged[0].width).toBeCloseTo(0.33, 4);
      expect(merged[1].x).toBeCloseTo(0.53, 4);
      expect(merged[1].width).toBeCloseTo(0.34, 4);
    });
  });

  describe("DOM passage bounding boxes (resolveDomTextRects & resolvePassageRects)", () => {
    it("resolves normalized multi-line rects from real sample-2page.pdf text coordinates within 1e-3", async () => {
      const { pdfProxy, destroy } = await loadPdfFixture(SAMPLE_2PAGE_PATH);
      try {
        const page1 = await pdfProxy.getPage(1);
        const extracted1 = await extractNormalizedSpansFromPdfPage(page1);
        const host = createHost();

        mountMockPdfPageDom(host, {
          pageNumber: 1,
          baseWidth: extracted1.width,
          baseHeight: extracted1.height,
          zoomPercent: 100,
          offsetLeft: 60,
          offsetTop: 30,
          spans: extracted1.spans,
        });

        const rects = resolveDomTextRects(
          1,
          "Dense semantic retrieval accelerates scholarly reading workflows by mapping multi-page academic manuscripts into compact vector",
        );

        expect(rects).toHaveLength(2);
        for (const r of rects) assertNormalizedRect(r);

        const line1Expected = extracted1.spans.find((s) =>
          s.text.startsWith("Dense semantic retrieval"),
        )!;
        const line2Expected = extracted1.spans.find((s) =>
          s.text.startsWith("by mapping multi-page"),
        )!;

        expect(rects[0].x).toBeCloseTo(line1Expected.x, 3);
        expect(rects[0].y).toBeCloseTo(line1Expected.y, 3);
        expect(rects[0].width).toBeCloseTo(line1Expected.width, 3);
        expect(rects[0].height).toBeCloseTo(line1Expected.height, 3);

        expect(rects[1].x).toBeCloseTo(line2Expected.x, 3);
        expect(rects[1].y).toBeCloseTo(line2Expected.y, 3);
        expect(rects[1].width).toBeCloseTo(line2Expected.width, 3);
        expect(rects[1].height).toBeCloseTo(line2Expected.height, 3);
      } finally {
        await destroy();
      }
    });

    it("merges split <span> text nodes on the same line and handles soft hyphens & line-break de-hyphenation", () => {
      const host = createHost();
      const spans: NormalizedSpanLayout[] = [
        // Split spans on the same line
        { text: "Fast", x: 0.1, y: 0.15, width: 0.08, height: 0.02 },
        { text: "vector", x: 0.184, y: 0.15, width: 0.1, height: 0.02 },
        { text: "lookup", x: 0.288, y: 0.15, width: 0.11, height: 0.02 },
        // Soft hyphen inside span + line-break hyphenation across two lines
        {
          text: "cross-docu\u00ADment tokeniza-",
          x: 0.1,
          y: 0.25,
          width: 0.42,
          height: 0.02,
        },
        {
          text: "tion windows",
          x: 0.1,
          y: 0.28,
          width: 0.22,
          height: 0.02,
        },
      ];

      mountMockPdfPageDom(host, {
        pageNumber: 1,
        baseWidth: 612,
        baseHeight: 792,
        zoomPercent: 100,
        spans,
      });

      const splitRects = resolveDomTextRects(1, "Fast vector lookup");
      expect(splitRects).toHaveLength(1);
      assertNormalizedRect(splitRects[0]);
      expect(splitRects[0].x).toBeCloseTo(0.1, 3);
      expect(splitRects[0].x + splitRects[0].width).toBeCloseTo(0.398, 3);

      const dehyphRects = resolveDomTextRects(
        1,
        "cross-document tokenization windows",
      );
      expect(dehyphRects).toHaveLength(2);
      for (const r of dehyphRects) assertNormalizedRect(r);
      expect(dehyphRects[0].y).toBeCloseTo(0.25, 3);
      expect(dehyphRects[1].y).toBeCloseTo(0.28, 3);
    });

    it("is strictly zoom-invariant between 100% (612x792) and 150% (918x1188) page dimensions", () => {
      const spans: NormalizedSpanLayout[] = [
        {
          text: "Normalized coordinates remain invariant across zoom.",
          x: 0.12,
          y: 0.34,
          width: 0.64,
          height: 0.018,
        },
      ];

      const host100 = createHost();
      mountMockPdfPageDom(host100, {
        pageNumber: 1,
        baseWidth: 612,
        baseHeight: 792,
        zoomPercent: 100,
        offsetLeft: 25,
        offsetTop: 40,
        spans,
      });
      const rects100 = resolveDomTextRects(
        1,
        "Normalized coordinates remain invariant",
      );
      host100.remove();

      const host150 = createHost();
      mountMockPdfPageDom(host150, {
        pageNumber: 1,
        baseWidth: 612,
        baseHeight: 792,
        zoomPercent: 150,
        offsetLeft: 75,
        offsetTop: 120,
        spans,
      });
      const rects150 = resolveDomTextRects(
        1,
        "Normalized coordinates remain invariant",
      );

      expect(rects100).toHaveLength(1);
      expect(rects150).toHaveLength(1);
      assertNormalizedRect(rects100[0]);
      assertNormalizedRect(rects150[0]);
      expect(rects150[0].x).toBeCloseTo(rects100[0].x, 3);
      expect(rects150[0].y).toBeCloseTo(rects100[0].y, 3);
      expect(rects150[0].width).toBeCloseTo(rects100[0].width, 3);
      expect(rects150[0].height).toBeCloseTo(rects100[0].height, 3);
    });

    it("computes Page 2 rects strictly relative to [data-foliet-page='2'] and never leaks Page 1 coordinates", async () => {
      const host = createHost();
      mountMockPdfPageDom(host, {
        pageNumber: 1,
        baseWidth: 612,
        baseHeight: 792,
        offsetLeft: 40,
        offsetTop: 20,
        spans: [
          {
            text: "Shared heading text on page one",
            x: 0.1,
            y: 0.08,
            width: 0.5,
            height: 0.02,
          },
        ],
      });

      mountMockPdfPageDom(host, {
        pageNumber: 2,
        baseWidth: 612,
        baseHeight: 792,
        offsetLeft: 40,
        offsetTop: 840, // far below Page 1
        spans: [
          {
            text: "Shared heading text on page two",
            x: 0.52,
            y: 0.45,
            width: 0.38,
            height: 0.02,
          },
        ],
      });

      const page2Rects = await resolvePassageRects(
        "doc-2page",
        2,
        "Shared heading text on page two",
      );
      expect(page2Rects).toHaveLength(1);
      assertNormalizedRect(page2Rects[0]);
      expect(page2Rects[0].x).toBeCloseTo(0.52, 3);
      expect(page2Rects[0].y).toBeCloseTo(0.45, 3);
      expect(page2Rects[0].width).toBeCloseTo(0.38, 3);
      expect(page2Rects[0].height).toBeCloseTo(0.02, 3);

      // Verify RAG chunk fallback when passage isn't present in DOM textLayer
      mockRagBackend.chunksByDoc.set("doc-2page", [
        {
          chunkId: "chunk-p2-fallback",
          pageNumber: 2,
          chunkIndex: 0,
          text: "Fallback chunk excerpt stored in vector index for page two",
          rectSegments: [{ x: 0.12, y: 0.72, width: 0.4, height: 0.02 }],
        },
      ]);
      const fallbackRects = await resolvePassageRects(
        "doc-2page",
        2,
        "Fallback chunk excerpt stored in vector index",
      );
      expect(fallbackRects).toEqual([
        { x: 0.12, y: 0.72, width: 0.4, height: 0.02 },
      ]);
    });
  });

  describe("Crop caption extraction & overlay layer coordinates", () => {
    it("extracts captions below and above a crop rect and isolates left column from right column", async () => {
      const { pdfProxy, destroy } = await loadPdfFixture(SAMPLE_2PAGE_PATH);
      try {
        const page2 = await pdfProxy.getPage(2);
        const extracted2 = await extractNormalizedSpansFromPdfPage(page2);
        const host = createHost();
        const { pageWrapper } = mountMockPdfPageDom(host, {
          pageNumber: 2,
          baseWidth: extracted2.width,
          baseHeight: extracted2.height,
          spans: extracted2.spans,
        });

        // Left-column crop covering the vector box above `Figure 1:` (PDF y=520..660 -> DOM y~0.167..0.343)
        const belowCaption = extractCaptionNearCropRect(pageWrapper, {
          x: 72 / 612,
          y: 132 / 792,
          width: 204 / 612,
          height: 140 / 792,
        });
        expect(belowCaption).toContain("Figure 1: Neural retrieval pipeline");
        expect(belowCaption).toContain("bounding-box spotlight projection.");
        // Must NOT leak right-column Table 2 at the same Y
        expect(belowCaption).not.toContain("Table 2");
        expect(belowCaption).not.toContain("right-column");
      } finally {
        await destroy();
      }

      // Caption ABOVE crop rect + 2-column isolation
      const hostAbove = createHost();
      const { pageWrapper: aboveWrapper } = mountMockPdfPageDom(hostAbove, {
        pageNumber: 1,
        baseWidth: 612,
        baseHeight: 792,
        spans: [
          {
            text: "Table 1: Ablation metrics across zoom levels.",
            x: 0.08,
            y: 0.22,
            width: 0.38,
            height: 0.016,
          },
          {
            text: "Figure 9: Right column distractor caption.",
            x: 0.54,
            y: 0.22,
            width: 0.36,
            height: 0.016,
          },
        ],
      });

      const aboveCaption = extractCaptionNearCropRect(aboveWrapper, {
        x: 0.08,
        y: 0.26,
        width: 0.38,
        height: 0.2,
      });
      expect(aboveCaption).toBe("Table 1: Ablation metrics across zoom levels.");
    });

    it("renders TextMarkupLayer with exact normalized percentage styles and underline variants", () => {
      const markups: TextMarkupAnnotation[] = [
        {
          id: "m-highlight",
          pageNumber: 1,
          toolType: "highlight",
          color: "#EAB308",
          text: "Key passage",
          rectSegments: [{ x: 0.125, y: 0.25, width: 0.5, height: 0.025 }],
          x: 0.125,
          y: 0.25,
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "m-squiggle",
          pageNumber: 1,
          toolType: "underline",
          underlineStyle: "squiggle",
          color: "#16A34A",
          text: "Squiggle text",
          rectSegments: [{ x: 0.2, y: 0.4, width: 0.3, height: 0.02 }],
          x: 0.2,
          y: 0.4,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ];

      const { container } = render(
        <TextMarkupLayer
          textMarkups={markups}
          ragHighlight={{
            chunkId: "rag-1",
            docId: "doc-1",
            docTitle: "Sample",
            pageNumber: 1,
            text: "RAG hit",
            similarityScore: 0.91,
            rectSegments: [{ x: 0.1, y: 0.6, width: 0.45, height: 0.03 }],
            highlightKind: "rag",
          }}
          isDimensionsSettled={true}
          isEraser={false}
          onDeleteAnnotation={vi.fn()}
        />,
      );

      const ragDiv = container.querySelector(
        'div[style*="left: 10%"][style*="top: 60%"]',
      ) as HTMLElement | null;
      expect(ragDiv).not.toBeNull();
      expect(ragDiv?.style.width).toBe("45%");
      expect(ragDiv?.style.height).toBe("3%");

      const hlDiv = container.querySelector(
        'div[style*="left: 12.5%"][style*="top: 25%"]',
      ) as HTMLElement | null;
      expect(hlDiv).not.toBeNull();
      expect(hlDiv?.style.width).toBe("50%");
      expect(hlDiv?.style.height).toBe("2.5%");

      // Squiggle underline renders SVG path
      const squiggleSvg = container.querySelector('svg[viewBox="0 0 100 8"]');
      expect(squiggleSvg).not.toBeNull();
    });

    it("normalizes CropAndNoteLayer drag-crop box identically across all 4 drag directions and clamps page drag-crop inside [0, 1]", async () => {
      const directions = [
        { name: "TL->BR", startX: 0.15, startY: 0.2, currX: 0.55, currY: 0.65 },
        { name: "BR->TL", startX: 0.55, startY: 0.65, currX: 0.15, currY: 0.2 },
        { name: "TR->BL", startX: 0.55, startY: 0.2, currX: 0.15, currY: 0.65 },
        { name: "BL->TR", startX: 0.15, startY: 0.65, currX: 0.55, currY: 0.2 },
      ];

      for (const dir of directions) {
        const { container, unmount } = render(
          <CropAndNoteLayer
            noteAnnotations={[]}
            cropRect={dir}
            quickInsertCrop={null}
            isSummaryWorkspaceOpen={false}
            isEraser={false}
            onDeleteAnnotation={vi.fn()}
            onNoteClick={vi.fn()}
            onDismissQuickInsert={vi.fn()}
          />,
        );
        const box = container.querySelector("div.border") as HTMLElement;
        expect(box, `Direction ${dir.name}`).not.toBeNull();
        expect(parseFloat(box.style.left)).toBeCloseTo(15, 3);
        expect(parseFloat(box.style.top)).toBeCloseTo(20, 3);
        expect(parseFloat(box.style.width)).toBeCloseTo(40, 3);
        expect(parseFloat(box.style.height)).toBeCloseTo(45, 3);
        unmount();
      }

      // Interactive out-of-bounds drag on PdfPage must clamp coordinates strictly to [0, 1]
      const onAddFigureCrop = vi.fn();
      const { container } = render(
        <PdfPage
          pageNumber={1}
          zoomLevel={100}
          renderZoomLevel={100}
          estimatedWidth={612}
          estimatedHeight={792}
          activeTool="area_select"
          activeColor="#0284C7"
          activeStrokeWidth={2}
          activeUnderlineStyle="solid"
          pageAnnotations={[]}
          registerPageRef={vi.fn()}
          onAddAnnotation={vi.fn()}
          onDeleteAnnotation={vi.fn()}
          onNoteClick={vi.fn()}
          onAddFigureCrop={onAddFigureCrop}
          onDimensionsDiscovered={vi.fn()}
        />,
      );

      const pageEl = container.querySelector(
        '[data-foliet-page="1"]',
      ) as HTMLElement;
      setElementRect(pageEl, { left: 100, top: 50, width: 612, height: 792 });
      const overlay = pageEl.querySelector(".touch-none") as HTMLElement;

      // Drag from outside top-left (-50, -50) to outside bottom-right (900, 1200)
      fireEvent.pointerDown(overlay, {
        button: 0,
        pointerId: 1,
        clientX: 50,
        clientY: 10,
      });
      fireEvent.pointerMove(overlay, {
        button: 0,
        pointerId: 1,
        clientX: 900,
        clientY: 1000,
      });
      fireEvent.pointerUp(overlay, {
        button: 0,
        pointerId: 1,
        clientX: 900,
        clientY: 1000,
      });

      expect(onAddFigureCrop).toHaveBeenCalledTimes(1);
      const payload = onAddFigureCrop.mock.calls[0][0];
      expect(payload.x).toBe(0);
      expect(payload.y).toBe(0);
      expect(payload.width).toBe(1);
      expect(payload.height).toBe(1);
    });

    it("renders InkLayer SVG viewBox matching page dimensions and maps normalized points accurately", () => {
      const ink: InkAnnotation = {
        id: "ink-1",
        pageNumber: 1,
        toolType: "freehand_write",
        color: "#4F46E5",
        strokeWidth: 3,
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.25 },
          { x: 0.5, y: 0.3 },
        ],
        x: 0.1,
        y: 0.2,
        createdAt: "2026-01-01T00:00:00Z",
      };

      const { container } = render(
        <InkLayer
          inkAnnotations={[ink]}
          inkDraft={[
            { x: 0.2, y: 0.5 },
            { x: 0.4, y: 0.55 },
          ]}
          activeColor="#DC2626"
          activeStrokeWidth={5}
          pageWidth={612}
          pageHeight={792}
          isEraser={false}
          onDeleteAnnotation={vi.fn()}
        />,
      );

      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 612 792");

      const paths = container.querySelectorAll("path");
      expect(paths.length).toBe(2);
      const savedPathD = paths[0].getAttribute("d") || "";
      expect(savedPathD.startsWith("M ")).toBe(true);
      expect(paths[0].getAttribute("fill")).toBe("#4F46E5");
      expect(paths[1].getAttribute("fill")).toBe("#DC2626");

      // Parse numeric coordinates from SVG path and verify all lie within the 612x792 page bounds (allowing half stroke width margin)
      const nums = savedPathD
        .match(/-?\d+(?:\.\d+)?/g)
        ?.map(Number) ?? [];
      expect(nums.length).toBeGreaterThan(4);
      for (let i = 0; i < nums.length; i += 2) {
        const px = nums[i];
        const py = nums[i + 1];
        expect(px).toBeGreaterThanOrEqual(0);
        expect(px).toBeLessThanOrEqual(612);
        expect(py).toBeGreaterThanOrEqual(0);
        expect(py).toBeLessThanOrEqual(792);
      }
    });
  });
});
