import type { RagPromptContextItem } from "@/services/llm";
import { RagService } from "@/services/rag";
import type { Rect } from "@/types/common";
import type { DocumentChunk } from "@/types/embedding";
import { mergeLineRects } from "@/utils/pdfGeometry";

export { mergeLineRects };

const ZERO_WIDTH_OR_SOFT_HYPHEN_RE = /[\u00AD\u200B\u200C\u200D\uFEFF]/g;
const CAPTION_START_RE =
    /^(?:fig(?:ure)?|table|tbl|chart|diagram|algorithm|listing|plate|scheme|exhibit)\s*\.?\s*(?:\d+|[ivxlcdm]+|[a-z]\.\d+)(?:\s*[:.\-–—]|\s+|$)/i;

function normalizeSearchText(text: string): string {
    return text
        .replace(ZERO_WIDTH_OR_SOFT_HYPHEN_RE, "")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2010-\u2013]/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

function getPageElements(pageNumber: number): {
    pageWrapper: HTMLElement;
    textLayer: HTMLElement;
} | null {
    if (typeof document === "undefined") return null;
    const pageWrapper = document.querySelector(
        `[data-foliet-page="${pageNumber}"]`,
    ) as HTMLElement | null;
    const textLayer = pageWrapper?.querySelector(
        ".react-pdf__Page__textContent, .textLayer",
    ) as HTMLElement | null;
    return pageWrapper && textLayer ? { pageWrapper, textLayer } : null;
}

export function readDomPageText(pageNumber: number): string {
    const els = getPageElements(pageNumber);
    if (!els) return "";
    return (els.textLayer.innerText || els.textLayer.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Extracts plain text directly from `pdfProxy` for a single page.
 */
export async function extractPdfPageText(
    pdfProxy: any,
    pageNumber: number,
): Promise<string> {
    if (!pdfProxy?.getPage) return "";
    try {
        const page = await pdfProxy.getPage(pageNumber);
        const content = await page.getTextContent();
        return (content?.items ?? [])
            .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    } catch {
        return "";
    }
}

/**
 * Waits for a page to be mounted and rendered in the DOM, optionally jumping to it.
 */
export async function waitForRenderedPage(
    pageNumber: number,
    jumpToPage?: (page: number) => void,
    options?: {
        timeoutMs?: number;
        requireCanvas?: boolean;
        requireTextLayer?: boolean;
    },
): Promise<HTMLElement | null> {
    if (typeof document === "undefined") return null;
    const timeoutMs = options?.timeoutMs ?? 1100;
    const requireCanvas = options?.requireCanvas ?? true;
    const requireTextLayer = options?.requireTextLayer ?? false;

    const findReady = () => {
        const wrapper = document.querySelector(
            `[data-foliet-page="${pageNumber}"]`,
        ) as HTMLElement | null;
        if (!wrapper) return null;
        if (requireCanvas) {
            const canvas = wrapper.querySelector(
                ".react-pdf__Page__canvas",
            ) as HTMLCanvasElement | null;
            if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
                return null;
            }
        }
        if (requireTextLayer) {
            const textLayer = wrapper.querySelector(
                ".react-pdf__Page__textContent, .textLayer",
            ) as HTMLElement | null;
            if (!textLayer?.querySelector("span")) {
                return null;
            }
        }
        return wrapper;
    };

    const immediate = findReady();
    if (immediate) return immediate;

    jumpToPage?.(pageNumber);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 90));
        const ready = findReady();
        if (ready) return ready;
    }

    return document.querySelector(
        `[data-foliet-page="${pageNumber}"]`,
    ) as HTMLElement | null;
}

export function readAnyRenderedPagesContext(): RagPromptContextItem[] {
    if (typeof document === "undefined") return [];
    const pages = Array.from(
        document.querySelectorAll("[data-foliet-page]"),
    ) as HTMLElement[];
    const seen = new Set<number>();
    const items: RagPromptContextItem[] = [];
    for (const el of pages) {
        const pageNumber = Number(el.getAttribute("data-foliet-page"));
        if (!Number.isFinite(pageNumber) || pageNumber < 1 || seen.has(pageNumber)) {
            continue;
        }
        seen.add(pageNumber);
        const text = readDomPageText(pageNumber);
        if (text.length >= 20) {
            items.push({ pageNumber, text: text.slice(0, 1800) });
        }
        if (items.length >= 4) break;
    }
    return items;
}

export async function getPageRagChunks(
    docId: string | undefined,
    startPage: number,
    endPage = startPage,
): Promise<DocumentChunk[]> {
    if (!docId) return [];
    try {
        const chunks = await RagService.getDocumentChunks(docId);
        return chunks
            .filter((c) => c.pageNumber >= startPage && c.pageNumber <= endPage)
            .sort((a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex);
    } catch {
        return [];
    }
}

export async function readPageContextText(
    docId: string | undefined,
    pageNumber: number,
    jumpToPage?: (page: number) => void,
): Promise<string> {
    const pageChunks = await getPageRagChunks(docId, pageNumber);
    if (pageChunks.length > 0) {
        return pageChunks
            .slice(0, 3)
            .map((c) => c.text)
            .join("\n\n")
            .slice(0, 2200);
    }

    const immediateDom = readDomPageText(pageNumber);
    if (immediateDom) return immediateDom.slice(0, 2200);

    if (jumpToPage) {
        await waitForRenderedPage(pageNumber, jumpToPage, {
            timeoutMs: 800,
            requireCanvas: false,
            requireTextLayer: true,
        });
        const afterJumpDom = readDomPageText(pageNumber);
        if (afterJumpDom) return afterJumpDom.slice(0, 2200);
    }

    return "";
}

interface SearchStream {
    text: string;
    rawStarts: number[];
    rawEnds: number[];
}

function getTextSpanOwner(node: Node, root: HTMLElement): Element | null {
    let el = node.parentElement;
    while (el && el !== root) {
        if (el.tagName === "SPAN") return el;
        el = el.parentElement;
    }
    return node.parentElement;
}

function findMatchInStream(
    haystack: string,
    needle: string,
): { start: number; len: number } | null {
    const exactIdx = haystack.indexOf(needle);
    if (exactIdx !== -1) {
        return { start: exactIdx, len: needle.length };
    }

    const words = needle.split(" ").filter(Boolean);
    if (words.length >= 6) {
        const anchorCount = Math.min(5, Math.floor(words.length / 2));
        const head = words.slice(0, anchorCount).join(" ");
        const tail = words.slice(-anchorCount).join(" ");
        const maxSpan = Math.ceil(needle.length * 1.6) + 120;

        let best: { start: number; len: number; diff: number } | null = null;
        let searchHeadFrom = 0;

        while (searchHeadFrom <= haystack.length - head.length) {
            const headIdx = haystack.indexOf(head, searchHeadFrom);
            if (headIdx === -1) break;

            const windowEnd = Math.min(haystack.length, headIdx + maxSpan);
            let searchTailFrom = headIdx + head.length;
            while (searchTailFrom <= windowEnd - tail.length) {
                const tailIdx = haystack.indexOf(tail, searchTailFrom);
                if (tailIdx === -1 || tailIdx + tail.length > windowEnd) break;

                const spanLen = tailIdx + tail.length - headIdx;
                const diff = Math.abs(spanLen - needle.length);
                if (!best || diff < best.diff) {
                    best = { start: headIdx, len: spanLen, diff };
                }
                searchTailFrom = tailIdx + 1;
            }
            searchHeadFrom = headIdx + 1;
        }

        if (best) {
            return { start: best.start, len: best.len };
        }

        const prefix = words.slice(0, Math.min(6, words.length)).join(" ");
        if (prefix.length >= 24) {
            const prefixIdx = haystack.indexOf(prefix);
            if (prefixIdx !== -1) {
                return { start: prefixIdx, len: prefix.length };
            }
        }
    }

    return null;
}

/**
 * Resolves exact line bounding rectangles from a rendered PDF page's DOM textLayer.
 */
export function resolveDomTextRects(
    pageNumber: number,
    targetText: string,
): Rect[] {
    const els = getPageElements(pageNumber);
    if (!els) return [];

    const pageRect = els.pageWrapper.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return [];

    const walker = document.createTreeWalker(els.textLayer, NodeFilter.SHOW_TEXT);
    const textNodes: Array<{
        node: Text;
        start: number;
        end: number;
        owner: Element | null;
    }> = [];
    let rawLen = 0;

    let current: Node | null;
    while ((current = walker.nextNode())) {
        const txt = current as Text;
        const val = txt.nodeValue ?? "";
        if (!val) continue;
        const start = rawLen;
        rawLen += val.length;
        textNodes.push({
            node: txt,
            start,
            end: rawLen,
            owner: getTextSpanOwner(txt, els.textLayer),
        });
    }

    if (textNodes.length === 0) return [];

    const primaryChars: string[] = [];
    const primaryStarts: number[] = [];
    const primaryEnds: number[] = [];
    let prevWasSpace = true;

    for (let idx = 0; idx < textNodes.length; idx++) {
        const entry = textNodes[idx];
        const val = entry.node.nodeValue ?? "";
        if (idx > 0) {
            const prev = textNodes[idx - 1];
            const prevVal = prev.node.nodeValue ?? "";
            if (
                prev.owner !== entry.owner &&
                !/\s$/.test(prevVal) &&
                !/^\s/.test(val) &&
                !prevWasSpace
            ) {
                primaryChars.push(" ");
                primaryStarts.push(-1);
                primaryEnds.push(-1);
                prevWasSpace = true;
            }
        }

        for (let offset = 0; offset < val.length;) {
            const cp = val.codePointAt(offset)!;
            const step = cp > 0xffff ? 2 : 1;
            const rawSlice = val.slice(offset, offset + step);
            const absStart = entry.start + offset;
            const absEnd = absStart + step;
            offset += step;

            if (ZERO_WIDTH_OR_SOFT_HYPHEN_RE.test(rawSlice)) {
                ZERO_WIDTH_OR_SOFT_HYPHEN_RE.lastIndex = 0;
                continue;
            }

            const normalized = rawSlice
                .normalize("NFKC")
                .toLowerCase()
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2010-\u2013]/g, "-");

            for (const ch of normalized) {
                if (/\s/.test(ch)) {
                    if (!prevWasSpace) {
                        primaryChars.push(" ");
                        primaryStarts.push(absStart);
                        primaryEnds.push(absEnd);
                        prevWasSpace = true;
                    }
                } else {
                    primaryChars.push(ch);
                    primaryStarts.push(absStart);
                    primaryEnds.push(absEnd);
                    prevWasSpace = false;
                }
            }
        }
    }

    const primaryStream: SearchStream = {
        text: primaryChars.join(""),
        rawStarts: primaryStarts,
        rawEnds: primaryEnds,
    };

    const needlePrimary = normalizeSearchText(targetText);
    if (!needlePrimary) return [];

    let matchedStream = primaryStream;
    let match = findMatchInStream(primaryStream.text, needlePrimary);

    if (!match) {
        const dehyphChars: string[] = [];
        const dehyphStarts: number[] = [];
        const dehyphEnds: number[] = [];

        for (let i = 0; i < primaryChars.length; i++) {
            if (
                primaryChars[i] === "-" &&
                i > 0 &&
                /[a-z0-9]/.test(primaryChars[i - 1])
            ) {
                const nextIdx = primaryChars[i + 1] === " " ? i + 2 : i + 1;
                if (
                    nextIdx < primaryChars.length &&
                    /[a-z0-9]/.test(primaryChars[nextIdx])
                ) {
                    if (primaryChars[i + 1] === " ") i++;
                    continue;
                }
            }
            dehyphChars.push(primaryChars[i]);
            dehyphStarts.push(primaryStarts[i]);
            dehyphEnds.push(primaryEnds[i]);
        }

        const dehyphStream: SearchStream = {
            text: dehyphChars.join(""),
            rawStarts: dehyphStarts,
            rawEnds: dehyphEnds,
        };
        const needleDehyphenated = needlePrimary.replace(
            /([a-z0-9])-\s*([a-z0-9])/g,
            "$1$2",
        );
        match = findMatchInStream(dehyphStream.text, needleDehyphenated);
        if (match) {
            matchedStream = dehyphStream;
        }
    }

    if (!match) return [];

    let startIdx = match.start;
    let endIdx = match.start + match.len - 1;
    while (startIdx <= endIdx && matchedStream.rawStarts[startIdx] === -1) {
        startIdx++;
    }
    while (endIdx >= startIdx && matchedStream.rawEnds[endIdx] === -1) {
        endIdx--;
    }
    if (startIdx > endIdx) return [];

    const rawStart = matchedStream.rawStarts[startIdx];
    const rawEnd = matchedStream.rawEnds[endIdx];
    if (rawStart < 0 || rawEnd <= rawStart) return [];

    const startEntry = textNodes.find((n) => rawStart >= n.start && rawStart < n.end);
    const endEntry = textNodes.find((n) => rawEnd > n.start && rawEnd <= n.end);
    if (!startEntry || !endEntry) return [];

    try {
        const range = document.createRange();
        range.setStart(startEntry.node, Math.max(0, rawStart - startEntry.start));
        range.setEnd(endEntry.node, Math.min(endEntry.node.length, rawEnd - endEntry.start));

        const rects = Array.from(range.getClientRects())
            .map((r) => ({
                x: Math.max(0, (r.left - pageRect.left) / pageRect.width),
                y: Math.max(0, (r.top - pageRect.top) / pageRect.height),
                width: Math.min(1, r.width / pageRect.width),
                height: Math.min(1, r.height / pageRect.height),
            }))
            .filter((r) => r.width > 0.002 && r.height > 0.002);

        return mergeLineRects(rects);
    } catch {
        return [];
    }
}

export async function resolvePassageRects(
    docId: string | undefined,
    pageNumber: number,
    passageText: string,
    jumpToPage?: (page: number) => void,
): Promise<Rect[]> {
    const domRects = resolveDomTextRects(pageNumber, passageText);
    if (domRects.length > 0) return domRects;

    if (jumpToPage) {
        await waitForRenderedPage(pageNumber, jumpToPage, {
            timeoutMs: 900,
            requireCanvas: false,
            requireTextLayer: true,
        });
        const retried = resolveDomTextRects(pageNumber, passageText);
        if (retried.length > 0) return retried;
    }

    const pageChunks = await getPageRagChunks(docId, pageNumber);
    if (pageChunks.length > 0) {
        const needle = normalizeSearchText(passageText);
        const snippet = needle.slice(0, 60);
        if (snippet.length >= 12) {
            const matched = pageChunks.find((c) => {
                const chunkNorm = normalizeSearchText(c.text);
                return (
                    chunkNorm.includes(needle) ||
                    chunkNorm.includes(snippet) ||
                    (chunkNorm.length >= 24 && needle.includes(chunkNorm.slice(0, 60)))
                );
            });
            if (matched?.rectSegments?.length) return matched.rectSegments;
        }
    }

    return [];
}

interface NormSpan {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
}

interface TextLine {
    text: string;
    x: number;
    y: number;
    right: number;
    bottom: number;
    height: number;
    spans: NormSpan[];
}

function groupSpansIntoLines(spans: NormSpan[]): TextLine[] {
    if (spans.length === 0) return [];
    const sorted = [...spans].sort((a, b) =>
        Math.abs(a.y - b.y) > 0.006 ? a.y - b.y : a.x - b.x,
    );
    const lines: TextLine[] = [];
    for (const sp of sorted) {
        const target = lines.find(
            (l) => Math.abs(l.y - sp.y) < Math.max(0.007, l.height * 0.55),
        );
        if (target) {
            target.spans.push(sp);
            target.x = Math.min(target.x, sp.x);
            target.y = Math.min(target.y, sp.y);
            target.right = Math.max(target.right, sp.right);
            target.bottom = Math.max(target.bottom, sp.bottom);
            target.height = Math.max(target.height, sp.height);
        } else {
            lines.push({
                text: sp.text,
                x: sp.x,
                y: sp.y,
                right: sp.right,
                bottom: sp.bottom,
                height: sp.height,
                spans: [sp],
            });
        }
    }
    for (const l of lines) {
        l.spans.sort((a, b) => a.x - b.x);
        l.text = l.spans.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    }
    return lines.sort((a, b) => a.y - b.y);
}

function joinCaptionLines(lines: TextLine[]): string {
    let out = "";
    for (const line of lines) {
        if (!out) {
            out = line.text;
        } else if (out.endsWith("-") && /^[a-z]/.test(line.text)) {
            out = out.slice(0, -1) + line.text;
        } else {
            out = `${out} ${line.text}`;
        }
    }
    return out.replace(/\s+/g, " ").trim().slice(0, 280);
}

function collectCaptionBlock(lines: TextLine[], startIdx: number): string | undefined {
    const collected: TextLine[] = [lines[startIdx]];
    let charCount = lines[startIdx].text.length;

    for (let i = startIdx + 1; i < lines.length && collected.length < 5; i++) {
        const prev = collected[collected.length - 1];
        const next = lines[i];
        const gap = next.y - prev.bottom;
        if (gap > Math.max(0.015, prev.height * 1.45)) break;
        if (CAPTION_START_RE.test(next.text)) break;
        if (charCount + next.text.length + 1 > 280) break;
        collected.push(next);
        charCount += next.text.length + 1;
    }

    const joined = joinCaptionLines(collected);
    return joined.length >= 4 ? joined : undefined;
}

/**
 * Scans `.textLayer` spans directly below (and above) a manual `area_select`
 * crop rect within the same column to auto-populate `crop.caption`.
 */
export function extractCaptionNearCropRect(
    pageWrapper: HTMLElement,
    crop: Rect,
): string | undefined {
    const pageRect = pageWrapper.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return undefined;

    const textLayer = pageWrapper.querySelector(
        ".react-pdf__Page__textContent, .textLayer",
    ) as HTMLElement | null;
    if (!textLayer) return undefined;

    const cropRight = crop.x + crop.width;
    const cropBottom = crop.y + crop.height;
    const allSpans: NormSpan[] = [];

    for (const el of Array.from(textLayer.querySelectorAll("span"))) {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const x = (r.left - pageRect.left) / pageRect.width;
        const y = (r.top - pageRect.top) / pageRect.height;
        const width = r.width / pageRect.width;
        const height = r.height / pageRect.height;
        allSpans.push({
            text,
            x,
            y,
            width,
            height,
            right: x + width,
            bottom: y + height,
        });
    }
    if (allSpans.length === 0) return undefined;

    const sortedHeights = allSpans.map((s) => s.height).sort((a, b) => a - b);
    const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)] || 0.014;

    const sameColumnSpans = allSpans.filter((s) => {
        const overlap = Math.min(cropRight + 0.04, s.right) - Math.max(crop.x - 0.04, s.x);
        if (overlap <= 0) return false;
        if (cropRight <= 0.51 && s.x >= 0.49) return false;
        if (crop.x >= 0.49 && s.right <= 0.51) return false;
        return true;
    });

    const belowLines = groupSpansIntoLines(
        sameColumnSpans.filter((s) => s.bottom >= cropBottom - 0.02 && s.y <= cropBottom + 0.11),
    );
    const aboveLines = groupSpansIntoLines(
        sameColumnSpans.filter((s) => s.y <= crop.y + 0.02 && s.bottom >= crop.y - 0.11),
    );

    const belowExplicitIdx = belowLines.findIndex((l) => CAPTION_START_RE.test(l.text));
    if (belowExplicitIdx !== -1) {
        return collectCaptionBlock(belowLines, belowExplicitIdx);
    }

    for (let i = aboveLines.length - 1; i >= 0; i--) {
        if (CAPTION_START_RE.test(aboveLines[i].text)) {
            return collectCaptionBlock(aboveLines, i);
        }
    }

    // Fallback: isolated or smaller-font adjacent caption block
    if (belowLines.length > 0 && belowLines[0].y - cropBottom <= 0.045) {
        const blockLines: TextLine[] = [belowLines[0]];
        for (let i = 1; i < belowLines.length && blockLines.length < 4; i++) {
            const gap = belowLines[i].y - blockLines[blockLines.length - 1].bottom;
            if (gap > Math.max(0.015, blockLines[blockLines.length - 1].height * 1.45)) break;
            blockLines.push(belowLines[i]);
        }
        const avgH =
            blockLines.reduce((sum, l) => sum + l.height, 0) / blockLines.length;
        const nextLineAfter = belowLines[blockLines.length];
        const hasSeparationAfter =
            !nextLineAfter ||
            nextLineAfter.y - blockLines[blockLines.length - 1].bottom >= 0.014;
        const candidate = joinCaptionLines(blockLines);
        if (
            candidate.length >= 10 &&
            candidate.length <= 240 &&
            /^[A-Z0-9(]/.test(candidate) &&
            (avgH < medianHeight * 0.93 || (hasSeparationAfter && blockLines.length <= 3))
        ) {
            return candidate;
        }
    }

    if (aboveLines.length > 0 && crop.y - aboveLines[aboveLines.length - 1].bottom <= 0.045) {
        const blockLines: TextLine[] = [aboveLines[aboveLines.length - 1]];
        for (let i = aboveLines.length - 2; i >= 0 && blockLines.length < 4; i--) {
            const gap = blockLines[0].y - aboveLines[i].bottom;
            if (gap > Math.max(0.015, aboveLines[i].height * 1.45)) break;
            blockLines.unshift(aboveLines[i]);
        }
        const avgH =
            blockLines.reduce((sum, l) => sum + l.height, 0) / blockLines.length;
        const prevLineBefore =
            aboveLines.length - blockLines.length - 1 >= 0
                ? aboveLines[aboveLines.length - blockLines.length - 1]
                : null;
        const hasSeparationBefore =
            !prevLineBefore || blockLines[0].y - prevLineBefore.bottom >= 0.014;
        const candidate = joinCaptionLines(blockLines);
        if (
            candidate.length >= 10 &&
            candidate.length <= 240 &&
            /^[A-Z0-9(]/.test(candidate) &&
            (avgH < medianHeight * 0.93 || (hasSeparationBefore && blockLines.length <= 3))
        ) {
            return candidate;
        }
    }

    return undefined;
}