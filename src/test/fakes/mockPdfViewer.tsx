import React, { useEffect, useLayoutEffect, useRef } from "react";
import {
  type NormalizedSpanLayout,
  populateTextLayerWithGeometry,
  setElementRect,
} from "@/test/helpers/domGeometry";

export interface MockPdfPageSpec {
  pageNumber: number;
  width: number;
  height: number;
  spans: NormalizedSpanLayout[];
}

export interface MockPdfDocumentConfig {
  pages: MockPdfPageSpec[];
  outline?: Array<{ title: string; pageNumber: number; dest?: string }>;
  pageLabels?: string[] | null;
}

/**
 * Default 2-page document matching `src/test/fixtures/sample-2page.pdf`
 * (612x792 Letter pages, multi-line text, hyphenated line break, two-column
 * Page 2 with `Figure 1:` caption and right-column gutter isolation).
 */
export const DEFAULT_TWO_PAGE_SPEC: MockPdfPageSpec[] = [
  {
    pageNumber: 1,
    width: 612,
    height: 792,
    spans: [
      {
        text: "Foliet Research Paper: Neural Retrieval Systems",
        x: 72 / 612,
        y: 56 / 792,
        width: 390 / 612,
        height: 16 / 792,
      },
      {
        text: "Dense semantic retrieval accelerates scholarly reading workflows",
        x: 72 / 612,
        y: 100 / 792,
        width: 440 / 612,
        height: 12 / 792,
      },
      {
        text: "by mapping multi-page academic manuscripts into compact vector",
        x: 72 / 612,
        y: 118 / 792,
        width: 430 / 612,
        height: 12 / 792,
      },
      {
        text: "representations for fast passage lookup.",
        x: 72 / 612,
        y: 136 / 792,
        width: 260 / 612,
        height: 12 / 792,
      },
      {
        text: "Our transformer architecture introduces cross-document tokeniza-",
        x: 72 / 612,
        y: 180 / 792,
        width: 440 / 612,
        height: 12 / 792,
      },
      {
        text: "tion and adaptive attention windows for scientific citations.",
        x: 72 / 612,
        y: 198 / 792,
        width: 380 / 612,
        height: 12 / 792,
      },
    ],
  },
  {
    pageNumber: 2,
    width: 612,
    height: 792,
    spans: [
      {
        text: "Section 2: Experimental Architecture and Results",
        x: 72 / 612,
        y: 58 / 792,
        width: 340 / 612,
        height: 14 / 792,
      },
      {
        text: "Figure 1: Neural retrieval pipeline and",
        x: 72 / 612,
        y: 282 / 792,
        width: 200 / 612,
        height: 10 / 792,
      },
      {
        text: "bounding-box spotlight projection.",
        x: 72 / 612,
        y: 296 / 792,
        width: 180 / 612,
        height: 10 / 792,
      },
      {
        text: "Left column analysis confirms that",
        x: 72 / 612,
        y: 342 / 792,
        width: 195 / 612,
        height: 11 / 792,
      },
      {
        text: "normalized coordinates remain invariant",
        x: 72 / 612,
        y: 358 / 792,
        width: 205 / 612,
        height: 11 / 792,
      },
      {
        text: "across arbitrary viewer zoom scales.",
        x: 72 / 612,
        y: 374 / 792,
        width: 195 / 612,
        height: 11 / 792,
      },
      {
        text: "Right column benchmark results show",
        x: 324 / 612,
        y: 142 / 792,
        width: 205 / 612,
        height: 11 / 792,
      },
      {
        text: "Table 2: Unrelated right-column metrics",
        x: 324 / 612,
        y: 282 / 792,
        width: 200 / 612,
        height: 10 / 792,
      },
      {
        text: "Additional evaluation across Page 2",
        x: 324 / 612,
        y: 342 / 792,
        width: 200 / 612,
        height: 11 / 792,
      },
      {
        text: "verifies multi-page citation jumping.",
        x: 324 / 612,
        y: 358 / 792,
        width: 195 / 612,
        height: 11 / 792,
      },
    ],
  },
];

export const DEFAULT_ONE_PAGE_SPEC: MockPdfPageSpec[] = [
  {
    pageNumber: 1,
    width: 200,
    height: 200,
    spans: [
      {
        text: "Hello, world!",
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.1,
      },
    ],
  },
];

let currentPdfConfig: MockPdfDocumentConfig = {
  pages: DEFAULT_TWO_PAGE_SPEC,
  outline: [
    { title: "Introduction", pageNumber: 1 },
    { title: "Experimental Architecture", pageNumber: 2 },
  ],
  pageLabels: null,
};

export function configureMockPdfViewer(
  config: Partial<MockPdfDocumentConfig>,
): void {
  currentPdfConfig = {
    pages: config.pages ?? DEFAULT_TWO_PAGE_SPEC,
    outline: config.outline ?? [
      { title: "Introduction", pageNumber: 1 },
      { title: "Experimental Architecture", pageNumber: 2 },
    ],
    pageLabels: config.pageLabels ?? null,
  };
}

export function resetMockPdfViewer(): void {
  configureMockPdfViewer({});
}

export function createMockPdfProxy(
  config: MockPdfDocumentConfig = currentPdfConfig,
) {
  const refToIndex = new Map<string, number>();
  const outlineItems = (config.outline ?? []).map((item, idx) => {
    const refId = `ref-${idx}`;
    refToIndex.set(refId, Math.max(0, item.pageNumber - 1));
    return {
      title: item.title,
      dest: [refId],
      items: [],
    };
  });

  return {
    numPages: config.pages.length,
    getPage: async (pageNumber: number) => {
      const spec =
        config.pages.find((p) => p.pageNumber === pageNumber) ??
        config.pages[0];
      return {
        pageNumber,
        getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({
          width: spec.width * scale,
          height: spec.height * scale,
        }),
        getTextContent: async () => ({
          items: spec.spans.map((s) => ({
            str: s.text,
            width: s.width * spec.width,
            height: s.height * spec.height,
            transform: [
              1,
              0,
              0,
              s.height * spec.height,
              s.x * spec.width,
              spec.height * (1 - s.y - s.height),
            ],
          })),
        }),
      };
    },
    getOutline: async () => outlineItems,
    getPageLabels: async () => config.pageLabels ?? null,
    getDestination: async (dest: string) => [dest],
    getPageIndex: async (ref: string) => refToIndex.get(ref) ?? 0,
  };
}

interface MockDocumentProps {
  file?: unknown;
  onLoadSuccess?: (pdf: any) => void;
  children?: React.ReactNode;
}

export const MockPdfDocument: React.FC<MockDocumentProps> = ({
  file,
  onLoadSuccess,
  children,
}) => {
  const onLoadSuccessRef = useRef(onLoadSuccess);
  onLoadSuccessRef.current = onLoadSuccess;

  useEffect(() => {
    const proxy = createMockPdfProxy(currentPdfConfig);
    onLoadSuccessRef.current?.(proxy);
  }, [file]);

  return <div data-testid="mock-react-pdf-document">{children}</div>;
};

interface MockPageProps {
  pageNumber: number;
  scale?: number;
  onLoadSuccess?: (page: any) => void;
  onRenderSuccess?: () => void;
}

export const MockPdfPage: React.FC<MockPageProps> = ({
  pageNumber,
  scale = 1,
  onLoadSuccess,
  onRenderSuccess,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const onLoadSuccessRef = useRef(onLoadSuccess);
  const onRenderSuccessRef = useRef(onRenderSuccess);
  onLoadSuccessRef.current = onLoadSuccess;
  onRenderSuccessRef.current = onRenderSuccess;

  const spec =
    currentPdfConfig.pages.find((p) => p.pageNumber === pageNumber) ??
    currentPdfConfig.pages[0] ?? {
      pageNumber,
      width: 612,
      height: 792,
      spans: [],
    };

  const widthPx = Math.round(spec.width * scale);
  const heightPx = Math.round(spec.height * scale);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    if (!root || !canvas || !textLayer) return;

    canvas.width = widthPx;
    canvas.height = heightPx;

    const pageWrapper =
      (root.closest("[data-foliet-page]") as HTMLElement | null) ?? root;
    const offsetLeft = 40;
    const offsetTop = (pageNumber - 1) * (heightPx + 28) + 20;

    setElementRect(canvas, {
      left: offsetLeft,
      top: offsetTop,
      width: widthPx,
      height: heightPx,
    });

    populateTextLayerWithGeometry(pageWrapper, textLayer, {
      pageWidthPx: widthPx,
      pageHeightPx: heightPx,
      offsetLeft,
      offsetTop,
      spans: spec.spans,
    });

    onLoadSuccessRef.current?.({
      pageNumber,
      getViewport: ({ scale: s = 1 }: { scale?: number } = {}) => ({
        width: spec.width * s,
        height: spec.height * s,
      }),
    });
    onRenderSuccessRef.current?.();
  }, [pageNumber, scale, widthPx, heightPx, spec]);

  return (
    <div
      ref={rootRef}
      className="react-pdf__Page"
      data-page-number={pageNumber}
      style={{ width: widthPx, height: heightPx, position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        className="react-pdf__Page__canvas"
        width={widthPx}
        height={heightPx}
      />
      <div
        ref={textLayerRef}
        className="react-pdf__Page__textContent textLayer"
      />
    </div>
  );
};

export const mockReactPdfModule = {
  Document: MockPdfDocument,
  Page: MockPdfPage,
  pdfjs: {
    GlobalWorkerOptions: { workerSrc: "" },
    version: "5.0.0",
  },
};
