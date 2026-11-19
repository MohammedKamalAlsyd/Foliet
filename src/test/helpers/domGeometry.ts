/**
 * Reusable DOM & PDF layout-geometry helpers for JSDOM workflow tests.
 *
 * Assigns realistic pixel bounding boxes (`getBoundingClientRect`) to
 * `[data-foliet-page]` wrappers and their `.textLayer` `<span>` elements and
 * polyfills `Range.prototype.getClientRects` / `getBoundingClientRect` using
 * substring-proportional interpolation over each intersected text node's span.
 */

export interface NormalizedSpanLayout {
  text: string;
  /** Normalized left coordinate in [0, 1] relative to page width */
  x: number;
  /** Normalized top coordinate in [0, 1] relative to page height */
  y: number;
  /** Normalized width in [0, 1] relative to page width */
  width: number;
  /** Normalized height in [0, 1] relative to page height */
  height: number;
}

export interface PageGeometryOptions {
  pageNumber: number;
  /** Unscaled PDF page width in CSS px at 100% zoom (default 612) */
  baseWidth?: number;
  /** Unscaled PDF page height in CSS px at 100% zoom (default 792) */
  baseHeight?: number;
  /** Zoom percentage (e.g. 100 -> 612x792, 150 -> 918x1188) */
  zoomPercent?: number;
  /** Page wrapper viewport left offset in px */
  offsetLeft?: number;
  /** Page wrapper viewport top offset in px */
  offsetTop?: number;
  spans: NormalizedSpanLayout[];
  includeCanvas?: boolean;
}

export function createDomRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  const right = left + width;
  const bottom = top + height;
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right,
    bottom,
    toJSON() {
      return { x: left, y: top, left, top, width, height, right, bottom };
    },
  } as DOMRect;
}

const elementRectStore = new WeakMap<Element, () => DOMRect>();

export function setElementRect(
  el: Element,
  rect: { left: number; top: number; width: number; height: number },
): DOMRect {
  const domRect = createDomRect(rect.left, rect.top, rect.width, rect.height);
  elementRectStore.set(el, () => domRect);
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => domRect,
  });
  Object.defineProperty(el, "getClientRects", {
    configurable: true,
    value: () => makeDomRectList([domRect]),
  });
  return domRect;
}

export function makeDomRectList(rects: DOMRect[]): DOMRectList {
  const arr = [...rects] as unknown as DOMRectList & DOMRect[];
  Object.defineProperty(arr, "item", {
    configurable: true,
    value: (index: number) => rects[index] ?? null,
  });
  return arr;
}

function getEffectiveElementRect(el: Element | null): DOMRect {
  if (!el) return createDomRect(0, 0, 0, 0);
  const getter = elementRectStore.get(el);
  if (getter) return getter();
  return el.getBoundingClientRect();
}

function collectRangeTextSlices(
  range: Range,
): Array<{ node: Text; startOffset: number; endOffset: number }> {
  if (range.collapsed) return [];

  const ancestor = range.commonAncestorContainer;
  if (ancestor.nodeType === Node.TEXT_NODE) {
    const txt = ancestor as Text;
    if (range.endOffset <= range.startOffset) return [];
    return [
      {
        node: txt,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
      },
    ];
  }

  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
  const slices: Array<{ node: Text; startOffset: number; endOffset: number }> =
    [];
  let started = false;
  let current: Node | null;

  while ((current = walker.nextNode())) {
    const txt = current as Text;
    const len = txt.nodeValue?.length ?? 0;

    if (!started) {
      if (txt === range.startContainer) {
        started = true;
      } else if (
        range.startContainer.nodeType === Node.ELEMENT_NODE &&
        range.intersectsNode(txt)
      ) {
        started = true;
      } else {
        continue;
      }
    }

    const startOffset = txt === range.startContainer ? range.startOffset : 0;
    const endOffset = txt === range.endContainer ? range.endOffset : len;

    if (endOffset > startOffset && len > 0) {
      slices.push({ node: txt, startOffset, endOffset });
    }

    if (txt === range.endContainer) {
      break;
    }
  }

  return slices;
}

function computeRangeClientRects(range: Range): DOMRect[] {
  const slices = collectRangeTextSlices(range);
  const rects: DOMRect[] = [];

  for (const { node, startOffset, endOffset } of slices) {
    const owner = node.parentElement;
    if (!owner) continue;
    const ownerRect = getEffectiveElementRect(owner);
    if (ownerRect.width <= 0 || ownerRect.height <= 0) continue;

    const fullLen = Math.max(1, node.nodeValue?.length ?? 1);
    const clampedStart = Math.max(0, Math.min(fullLen, startOffset));
    const clampedEnd = Math.max(clampedStart, Math.min(fullLen, endOffset));
    const ratioStart = clampedStart / fullLen;
    const ratioLen = (clampedEnd - clampedStart) / fullLen;

    const left = ownerRect.left + ownerRect.width * ratioStart;
    const width = ownerRect.width * ratioLen;
    if (width > 0) {
      rects.push(createDomRect(left, ownerRect.top, width, ownerRect.height));
    }
  }

  return rects;
}

let rangePolyfillInstalled = false;

export function installRangeGeometryPolyfill(): void {
  if (rangePolyfillInstalled || typeof Range === "undefined") return;
  rangePolyfillInstalled = true;

  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      return makeDomRectList(computeRangeClientRects(this));
    },
  });

  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Range) {
      const rects = computeRangeClientRects(this);
      if (rects.length === 0) return createDomRect(0, 0, 0, 0);
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return createDomRect(left, top, right - left, bottom - top);
    },
  });
}

/**
 * Applies pixel bounding boxes to an existing `[data-foliet-page]` wrapper and
 * creates/positions its `.textLayer` `<span>` children using normalized coords.
 */
export function populateTextLayerWithGeometry(
  pageWrapper: HTMLElement,
  textLayer: HTMLElement,
  opts: {
    pageWidthPx: number;
    pageHeightPx: number;
    offsetLeft?: number;
    offsetTop?: number;
    spans: NormalizedSpanLayout[];
  },
): HTMLSpanElement[] {
  const offsetLeft = opts.offsetLeft ?? 0;
  const offsetTop = opts.offsetTop ?? 0;

  setElementRect(pageWrapper, {
    left: offsetLeft,
    top: offsetTop,
    width: opts.pageWidthPx,
    height: opts.pageHeightPx,
  });

  textLayer.innerHTML = "";
  const created: HTMLSpanElement[] = [];

  for (const spanDef of opts.spans) {
    const span = document.createElement("span");
    span.textContent = spanDef.text;
    const left = offsetLeft + spanDef.x * opts.pageWidthPx;
    const top = offsetTop + spanDef.y * opts.pageHeightPx;
    const width = spanDef.width * opts.pageWidthPx;
    const height = spanDef.height * opts.pageHeightPx;
    span.style.position = "absolute";
    span.style.left = `${spanDef.x * 100}%`;
    span.style.top = `${spanDef.y * 100}%`;
    span.style.width = `${spanDef.width * 100}%`;
    span.style.height = `${spanDef.height * 100}%`;
    setElementRect(span, { left, top, width, height });
    textLayer.appendChild(span);
    created.push(span);
  }

  return created;
}

/**
 * Builds and mounts a realistic `[data-foliet-page="N"]` DOM subtree with
 * `.react-pdf__Page__canvas` and positioned `.textLayer` spans.
 */
export function mountMockPdfPageDom(
  container: HTMLElement,
  options: PageGeometryOptions,
): {
  pageWrapper: HTMLDivElement;
  textLayer: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  spans: HTMLSpanElement[];
} {
  const baseWidth = options.baseWidth ?? 612;
  const baseHeight = options.baseHeight ?? 792;
  const scale = (options.zoomPercent ?? 100) / 100;
  const pageWidthPx = Math.round(baseWidth * scale);
  const pageHeightPx = Math.round(baseHeight * scale);
  const offsetLeft = options.offsetLeft ?? 40;
  const offsetTop =
    options.offsetTop ?? (options.pageNumber - 1) * (pageHeightPx + 28) + 20;

  const pageWrapper = document.createElement("div");
  pageWrapper.setAttribute("data-foliet-page", String(options.pageNumber));
  pageWrapper.style.width = `${pageWidthPx}px`;
  pageWrapper.style.height = `${pageHeightPx}px`;

  let canvas: HTMLCanvasElement | null = null;
  if (options.includeCanvas !== false) {
    canvas = document.createElement("canvas");
    canvas.className = "react-pdf__Page__canvas";
    canvas.width = pageWidthPx;
    canvas.height = pageHeightPx;
    setElementRect(canvas, {
      left: offsetLeft,
      top: offsetTop,
      width: pageWidthPx,
      height: pageHeightPx,
    });
    pageWrapper.appendChild(canvas);
  }

  const textLayer = document.createElement("div");
  textLayer.className = "react-pdf__Page__textContent textLayer";
  pageWrapper.appendChild(textLayer);

  const spans = populateTextLayerWithGeometry(pageWrapper, textLayer, {
    pageWidthPx,
    pageHeightPx,
    offsetLeft,
    offsetTop,
    spans: options.spans,
  });

  container.appendChild(pageWrapper);
  return { pageWrapper, textLayer, canvas, spans };
}

/**
 * Converts real `pdfjs-dist` `page.getTextContent()` items into normalized
 * `[0, 1]` top-left `NormalizedSpanLayout[]` using the page's scale-1 viewport.
 */
export async function extractNormalizedSpansFromPdfPage(
  pdfPage: any,
): Promise<{
  width: number;
  height: number;
  spans: NormalizedSpanLayout[];
}> {
  const viewport = pdfPage.getViewport({ scale: 1 });
  const content = await pdfPage.getTextContent();
  const spans: NormalizedSpanLayout[] = [];

  for (const item of content.items ?? []) {
    const str = typeof item?.str === "string" ? item.str : "";
    if (!str.trim()) continue;
    const tx: number[] = item.transform ?? [1, 0, 0, 12, 0, 0];
    const fontHeight = Math.max(
      6,
      Math.abs(item.height || Math.hypot(tx[2] || 0, tx[3] || 12)),
    );
    const pdfX = tx[4] ?? 0;
    const pdfY = tx[5] ?? 0;
    const itemWidth = Math.max(
      fontHeight * 0.5,
      item.width || str.length * fontHeight * 0.52,
    );

    // PDF origin is bottom-left; DOM origin is top-left.
    const x = Math.max(0, Math.min(0.99, pdfX / viewport.width));
    const topPx = viewport.height - pdfY - fontHeight * 0.85;
    const y = Math.max(0, Math.min(0.99, topPx / viewport.height));
    const width = Math.min(1 - x, itemWidth / viewport.width);
    const height = Math.min(1 - y, fontHeight / viewport.height);

    spans.push({ text: str, x, y, width, height });
  }

  return { width: viewport.width, height: viewport.height, spans };
}

/**
 * Selects a substring across one or more text nodes inside `root` and sets it
 * as the active `window.getSelection()`.
 */
export function selectTextInElement(root: Element, targetText: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Array<{ node: Text; start: number; end: number }> = [];
  let combined = "";
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const txt = current as Text;
    const val = txt.nodeValue ?? "";
    if (!val) continue;
    if (nodes.length > 0 && !/\s$/.test(combined) && !/^\s/.test(val)) {
      combined += " ";
    }
    const start = combined.length;
    combined += val;
    nodes.push({ node: txt, start, end: combined.length });
  }

  const idx = combined.indexOf(targetText);
  if (idx === -1) {
    throw new Error(
      `selectTextInElement: Could not find "${targetText}" in "${combined}"`,
    );
  }
  const endIdx = idx + targetText.length;

  const startEntry = nodes.find((n) => idx >= n.start && idx < n.end);
  const endEntry = nodes.find((n) => endIdx > n.start && endIdx <= n.end);
  if (!startEntry || !endEntry) {
    throw new Error(
      `selectTextInElement: Failed to map range bounds for "${targetText}"`,
    );
  }

  const range = document.createRange();
  range.setStart(startEntry.node, idx - startEntry.start);
  range.setEnd(endEntry.node, endIdx - endEntry.start);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}
