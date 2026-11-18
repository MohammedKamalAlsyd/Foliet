import type { RagPromptContextItem } from "@/services/llm";
import { RagService } from "@/services/rag";
import type { Rect } from "@/types/common";
import type { DocumentChunk } from "@/types/embedding";

export function mergeLineRects(rects: Rect[]): Rect[] {
    if (rects.length <= 1) return rects;
    const sorted = [...rects].sort((a, b) =>
        Math.abs(a.y - b.y) > 0.004 ? a.y - b.y : a.x - b.x,
    );
    const merged: Rect[] = [];
    for (const r of sorted) {
        const target = merged.find((m) => {
            const overlapY =
                Math.min(m.y + m.height, r.y + r.height) - Math.max(m.y, r.y);
            const minH = Math.min(m.height, r.height);
            const sameLine = minH > 0 && overlapY / minH > 0.5;
            const horizontalTouch =
                r.x <= m.x + m.width + 0.008 && m.x <= r.x + r.width + 0.008;
            return sameLine && horizontalTouch;
        });
        if (target) {
            const minX = Math.min(target.x, r.x);
            const minY = Math.min(target.y, r.y);
            const maxX = Math.max(target.x + target.width, r.x + r.width);
            const maxY = Math.max(target.y + target.height, r.y + r.height);
            target.x = minX;
            target.y = minY;
            target.width = maxX - minX;
            target.height = maxY - minY;
        } else {
            merged.push({ ...r });
        }
    }
    return merged;
}

function getPageElements(pageNumber: number): {
    pageWrapper: HTMLElement;
    textLayer: HTMLElement;
} | null {
    if (typeof document === "undefined") return null;
    const pageWrapper = document.querySelector(
        `[data-page-number="${pageNumber}"]`,
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

export function readAnyRenderedPagesContext(): RagPromptContextItem[] {
    if (typeof document === "undefined") return [];
    const pages = Array.from(
        document.querySelectorAll("[data-page-number]"),
    ) as HTMLElement[];
    const items: RagPromptContextItem[] = [];
    for (const el of pages) {
        const pageNumber = Number(el.getAttribute("data-page-number"));
        if (!Number.isFinite(pageNumber) || pageNumber < 1) continue;
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
        jumpToPage(pageNumber);
        await new Promise((r) => setTimeout(r, 260));
        const afterJumpDom = readDomPageText(pageNumber);
        if (afterJumpDom) return afterJumpDom.slice(0, 2200);
    }

    return "";
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
    const textNodes: Array<{ node: Text; start: number; end: number }> = [];
    let rawFull = "";

    let current: Node | null;
    while ((current = walker.nextNode())) {
        const txt = current as Text;
        const val = txt.nodeValue ?? "";
        if (!val) continue;
        const start = rawFull.length;
        rawFull += val;
        textNodes.push({ node: txt, start, end: rawFull.length });
    }

    if (!rawFull.trim()) return [];

    const rawLower = rawFull.toLowerCase();
    const compactChars: string[] = [];
    const compactToRaw: number[] = [];
    let prevWasSpace = true;

    for (let i = 0; i < rawLower.length; i++) {
        const ch = rawLower[i];
        if (/\s/.test(ch)) {
            if (!prevWasSpace) {
                compactChars.push(" ");
                compactToRaw.push(i);
                prevWasSpace = true;
            }
        } else {
            compactChars.push(ch);
            compactToRaw.push(i);
            prevWasSpace = false;
        }
    }

    const compactHaystack = compactChars.join("");
    const compactNeedle = targetText.toLowerCase().replace(/\s+/g, " ").trim();
    if (!compactNeedle) return [];

    let matchStart = compactHaystack.indexOf(compactNeedle);
    let matchLen = compactNeedle.length;

    if (matchStart === -1) {
        const words = compactNeedle.split(" ").filter(Boolean);
        if (words.length >= 4) {
            const head = words.slice(0, Math.min(6, words.length)).join(" ");
            matchStart = compactHaystack.indexOf(head);
            matchLen = head.length;
        }
    }

    if (matchStart === -1) return [];

    const rawStart = compactToRaw[matchStart] ?? 0;
    const rawEnd =
        (compactToRaw[Math.min(compactToRaw.length - 1, matchStart + matchLen - 1)] ??
            rawStart) + 1;

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

    const pageChunks = await getPageRagChunks(docId, pageNumber);
    if (pageChunks.length > 0) {
        const needle = passageText.toLowerCase().replace(/\s+/g, " ").trim();
        const matched =
            pageChunks.find((c) =>
                c.text.toLowerCase().replace(/\s+/g, " ").includes(needle.slice(0, 60)),
            ) ?? pageChunks[0];
        if (matched?.rectSegments?.length) return matched.rectSegments;
    }

    if (jumpToPage) {
        jumpToPage(pageNumber);
        await new Promise((r) => setTimeout(r, 260));
        const retried = resolveDomTextRects(pageNumber, passageText);
        if (retried.length > 0) return retried;
    }

    return [];
}