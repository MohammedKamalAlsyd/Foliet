/**
 * Foliet - Caption-Anchored Figure Auto-Cropper & Summary Insertion Bridge
 *
 * Used by both Lio chat tools (`add_figure_to_summary`) and Summary Studio
 * to reuse existing `CropAnnotation`s on a page or capture vector/raster
 * figure regions directly from `.react-pdf__Page__canvas`.
 */

import { DocumentDatabase } from "@/services/storage/database";
import { useAnnotationStore } from "@/stores/annotationStore";
import { isCropAnnotation, type CropAnnotation } from "@/types/annotations";
import { formatCropMarkdown, resolveCropUri } from "@/utils/llmFormatting";
import { waitForRenderedPage } from "@/utils/pdfDom";

export interface CaptureFigureResult {
    crop: CropAnnotation;
    created: boolean;
}

function normalizeText(s: string): string {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Locates a caption span inside the page's `.textLayer` and computes a normalized
 * `[0..1]` figure bounding box directly above (or below if near page top) it.
 */
function findCaptionAnchoredBox(
    pageWrapper: HTMLElement,
    caption?: string,
): { x: number; y: number; width: number; height: number } {
    const fallback = { x: 0.08, y: 0.12, width: 0.84, height: 0.44 };
    const pageRect = pageWrapper.getBoundingClientRect();
    if (pageRect.width <= 0 || pageRect.height <= 0) return fallback;

    const textLayer = pageWrapper.querySelector(
        ".react-pdf__Page__textContent, .textLayer",
    ) as HTMLElement | null;
    if (!textLayer) return fallback;

    const spans = Array.from(textLayer.querySelectorAll("span")).filter(
        (sp) => (sp.textContent || "").trim().length > 0,
    );
    if (spans.length === 0) return fallback;

    const needle = caption ? normalizeText(caption) : "";
    let anchorEl: HTMLElement | null = null;

    if (needle) {
        const figNumMatch = /^(fig(?:ure)?\.?\s*\d+)/i.exec(needle);
        const figPrefix = figNumMatch ? figNumMatch[1].toLowerCase() : "";

        anchorEl =
            spans.find((sp) =>
                normalizeText(sp.textContent || "").includes(needle),
            ) ??
            (figPrefix
                ? spans.find((sp) =>
                    normalizeText(sp.textContent || "").startsWith(figPrefix),
                )
                : undefined) ??
            null;
    }

    if (!anchorEl) {
        anchorEl =
            spans.find((sp) =>
                /^(figure|fig\.?)\s*\d+[:.\s]/i.test((sp.textContent || "").trim()),
            ) ?? null;
    }

    if (!anchorEl) return fallback;

    const anchorRect = anchorEl.getBoundingClientRect();
    const captionTopNorm = (anchorRect.top - pageRect.top) / pageRect.height;
    const captionBottomNorm =
        (anchorRect.bottom - pageRect.top) / pageRect.height;

    if (captionTopNorm < 0.22) {
        const y = Math.max(0.04, captionTopNorm - 0.01);
        const height = Math.min(0.42, 0.92 - y);
        return { x: 0.07, y, width: 0.86, height };
    }

    const bottom = Math.min(0.95, captionBottomNorm + 0.015);
    const top = Math.max(0.05, captionTopNorm - 0.38);
    return {
        x: 0.07,
        y: top,
        width: 0.86,
        height: Math.max(0.14, bottom - top),
    };
}

/**
 * Finds an existing `CropAnnotation` on `pageNumber` or captures a caption-anchored
 * region from `.react-pdf__Page__canvas`, saves it to SQLite, and notifies the UI.
 */
export async function captureFigureCropFromPage(
    pageNumber: number,
    caption?: string,
    options?: {
        docId?: string;
        jumpToPage?: (page: number) => void;
    },
): Promise<CaptureFigureResult | null> {
    const cleanPage = Math.max(1, Math.round(pageNumber));
    const cleanCaption = caption?.trim();
    const docId = options?.docId;

    if (docId) {
        const existingAnnots = await DocumentDatabase.getAnnotations(docId).catch(
            () => [],
        );
        const pageCrops: CropAnnotation[] = [];
        for (const a of existingAnnots) {
            if (isCropAnnotation(a) && a.pageNumber === cleanPage) {
                pageCrops.push(a);
            }
        }
        if (pageCrops.length > 0) {
            const matched = cleanCaption
                ? (pageCrops.find((c) =>
                    normalizeText(c.caption || "").includes(
                        normalizeText(cleanCaption),
                    ),
                ) ?? pageCrops[0])
                : pageCrops[0];
            return { crop: matched, created: false };
        }
    }

    const pageWrapper = await waitForRenderedPage(cleanPage, options?.jumpToPage);
    if (!pageWrapper) return null;

    const canvas = pageWrapper.querySelector(
        ".react-pdf__Page__canvas",
    ) as HTMLCanvasElement | null;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return null;

    const box = findCaptionAnchoredBox(pageWrapper, cleanCaption);

    const sx = Math.max(0, Math.floor(box.x * canvas.width));
    const sy = Math.max(0, Math.floor(box.y * canvas.height));
    const sw = Math.max(
        1,
        Math.min(canvas.width - sx, Math.floor(box.width * canvas.width)),
    );
    const sh = Math.max(
        1,
        Math.min(canvas.height - sy, Math.floor(box.height * canvas.height)),
    );

    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const dataUrl = out.toDataURL("image/png");

    const id = `crop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const crop: CropAnnotation = {
        id,
        pageNumber: cleanPage,
        toolType: "area_select",
        color: "#06B6D4",
        imageUrl: `idb://${id}`,
        caption: cleanCaption || `Figure (Page ${cleanPage})`,
        createdAt: new Date().toISOString(),
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
    };

    await DocumentDatabase.saveFigureCrop(id, dataUrl, docId);

    if (docId) {
        await DocumentDatabase.appendAnnotation(docId, crop);
    }

    useAnnotationStore.getState().receiveCrop(crop, docId);

    return { crop, created: true };
}

/**
 * Inserts a figure crop into the live Summary editor (or appends to SQLite summary if closed).
 */
export async function insertFigureIntoSummary(
    crop: CropAnnotation,
    docId?: string,
): Promise<void> {
    const src = resolveCropUri(crop.id, crop.imageUrl);
    const alt = crop.caption?.trim() || `Figure (Page ${crop.pageNumber})`;

    let handledByLiveEditor = false;
    if (typeof window !== "undefined") {
        const evt = new CustomEvent("foliet:insert-summary-image", {
            cancelable: true,
            detail: { docId, src, alt, pageNumber: crop.pageNumber },
        });
        handledByLiveEditor = !window.dispatchEvent(evt);
    }

    if (!handledByLiveEditor && docId) {
        const existing = await DocumentDatabase.getSummary(docId);
        const mdImage = formatCropMarkdown(alt, crop.id, src);
        const currContent = existing?.content ?? "";
        if (!currContent.includes(src)) {
            const nextContent = currContent.trim()
                ? `${currContent.trimEnd()}\n\n${mdImage}\n`
                : `${mdImage}\n`;
            await DocumentDatabase.saveSummary(
                docId,
                nextContent,
                existing?.sourceSnapshot,
            );
        }
    }
}