import { resolveCropImageSrc } from "@/services/cropResolver";
import {
    captureFigureCropFromPage,
    insertFigureIntoSummary,
} from "@/services/figureCropper";
import type { LlmToolCall } from "@/services/llm";
import type { ToolVisionPayload } from "@/services/llm/types";
import { DocumentDatabase } from "@/services/storage/database";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useRagStore } from "@/stores/ragStore";
import {
    isCropAnnotation,
    type CropAnnotation,
    type TextMarkupAnnotation,
} from "@/types/annotations";
import type { ExecutedToolCall } from "@/types/chat";
import type { DocumentChunk } from "@/types/embedding";
import { formatCropMarkdown, resolveCropUri } from "@/utils/llmFormatting";
import {
    getPageRagChunks,
    readPageContextText,
    resolvePassageRects,
} from "@/utils/pdfDom";

export interface CopilotToolContext {
    docId?: string;
    docTitle?: string;
    jumpToPage?: (page: number) => void;
    supportsVision?: boolean;
    onVisionImageCaptured?: (payload: ToolVisionPayload) => void;
}

const FIGURE_ID_RE =
    /\b(fig(?:ure)?|table|tbl|chart|diagram|algorithm|alg|listing|plate|scheme|exhibit)\s*\.?\s*(\d+(?:\.\d+)?[a-z]?|[ivxlcdm]+)\b/gi;

const FIGURE_STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "these",
    "those",
    "into",
    "over",
    "under",
    "between",
    "fig",
    "figure",
    "table",
    "tbl",
    "chart",
    "diagram",
    "algorithm",
    "alg",
    "listing",
    "plate",
    "scheme",
    "exhibit",
    "page",
    "shown",
    "shows",
    "show",
]);

function extractFigureIdentifiers(text: string): string[] {
    const ids = new Set<string>();
    FIGURE_ID_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FIGURE_ID_RE.exec(text)) !== null) {
        const rawKind = match[1].toLowerCase();
        const kind =
            rawKind === "fig" || rawKind === "figure"
                ? "fig"
                : rawKind === "tbl" || rawKind === "table"
                    ? "table"
                    : rawKind === "alg" || rawKind === "algorithm"
                        ? "alg"
                        : rawKind;
        ids.add(`${kind}:${match[2].toLowerCase()}`);
    }
    return Array.from(ids);
}

function tokenizeCaption(text: string): Set<string> {
    const tokens = new Set<string>();
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
        if (word.length >= 3 && !FIGURE_STOPWORDS.has(word)) {
            tokens.add(word);
        }
    }
    return tokens;
}

function scoreFigureCandidate(
    candidateText: string,
    caption: string,
): { score: number; hasIdMatch: boolean; overlapCount: number; overlapRatio: number } {
    if (!candidateText.trim()) {
        return { score: 0, hasIdMatch: false, overlapCount: 0, overlapRatio: 0 };
    }

    const queryIds = extractFigureIdentifiers(caption);
    const candidateIds = extractFigureIdentifiers(candidateText);
    const hasIdMatch =
        queryIds.length > 0 && queryIds.some((id) => candidateIds.includes(id));

    const queryTokens = tokenizeCaption(caption);
    const candidateTokens = tokenizeCaption(candidateText);
    let overlapCount = 0;
    for (const tok of queryTokens) {
        if (candidateTokens.has(tok)) overlapCount += 1;
    }

    const overlapRatio = queryTokens.size > 0 ? overlapCount / queryTokens.size : 0;
    let score = (hasIdMatch ? 10 : 0) + overlapRatio * 5 + Math.min(overlapCount, 4) * 0.5;

    if (queryIds.length > 0 && !hasIdMatch && candidateIds.length > 0) {
        const queryKinds = new Set(queryIds.map((id) => id.split(":")[0]));
        const hasConflictingSameKind = candidateIds.some((id) =>
            queryKinds.has(id.split(":")[0]),
        );
        if (hasConflictingSameKind) score -= 4;
    }

    return { score, hasIdMatch, overlapCount, overlapRatio };
}

function findMatchingFigureChunk(
    pageChunks: DocumentChunk[],
    caption: string,
): DocumentChunk | null {
    if (pageChunks.length === 0) return null;

    if (!caption) {
        return (
            pageChunks.find((c) => extractFigureIdentifiers(c.text).length > 0) ??
            pageChunks[0]
        );
    }

    const queryIds = extractFigureIdentifiers(caption);
    const queryTokens = tokenizeCaption(caption);

    let bestChunk: DocumentChunk | null = null;
    let bestScore = 0;

    for (const chunk of pageChunks) {
        const metrics = scoreFigureCandidate(chunk.text, caption);
        const meetsThreshold =
            metrics.hasIdMatch ||
            (queryIds.length === 0 &&
                (queryTokens.size >= 3
                    ? metrics.overlapCount >= 2 && metrics.overlapRatio >= 0.4
                    : metrics.overlapCount >= 1)) ||
            (queryIds.length > 0 &&
                queryTokens.size >= 2 &&
                metrics.overlapCount >= 2 &&
                metrics.overlapRatio >= 0.6);

        if (meetsThreshold && metrics.score > bestScore) {
            bestScore = metrics.score;
            bestChunk = chunk;
        }
    }

    return bestChunk;
}

async function resolveCropForFigureExplanation(params: {
    docId?: string;
    pageNumber: number;
    caption: string;
    jumpToPage?: (page: number) => void;
}): Promise<{ crop: CropAnnotation; dataUrl: string } | null> {
    if (!params.docId) return null;

    let selectedCrop: CropAnnotation | null = null;
    try {
        const annotations = await DocumentDatabase.getAnnotations(params.docId);
        const pageCrops = annotations.filter(
            (a): a is CropAnnotation =>
                isCropAnnotation(a) && a.pageNumber === params.pageNumber,
        );
        if (pageCrops.length > 0) {
            if (!params.caption) {
                selectedCrop = pageCrops[0];
            } else {
                let bestScore = 0;
                for (const crop of pageCrops) {
                    if (!crop.caption) continue;
                    const metrics = scoreFigureCandidate(crop.caption, params.caption);
                    if (
                        (metrics.hasIdMatch || metrics.overlapCount >= 1) &&
                        metrics.score > bestScore
                    ) {
                        bestScore = metrics.score;
                        selectedCrop = crop;
                    }
                }
            }
        }
    } catch {
        // Fall through to auto-capture
    }

    if (!selectedCrop) {
        const captured = await captureFigureCropFromPage(
            params.pageNumber,
            params.caption || undefined,
            { docId: params.docId, jumpToPage: params.jumpToPage },
        );
        if (captured?.crop) {
            selectedCrop = captured.crop;
        }
    }

    if (!selectedCrop) return null;

    let dataUrl: string | null = null;
    if (selectedCrop.imageUrl.startsWith("data:")) {
        dataUrl = selectedCrop.imageUrl;
    } else {
        const uri = resolveCropUri(selectedCrop.id, selectedCrop.imageUrl);
        dataUrl = await resolveCropImageSrc(uri).catch(() => null);
    }

    if (!dataUrl || !dataUrl.startsWith("data:")) return null;
    return { crop: selectedCrop, dataUrl };
}

export async function executeCopilotToolCall(
    call: LlmToolCall,
    context: CopilotToolContext,
): Promise<ExecutedToolCall> {
    const args = call.arguments || {};
    const pageNumber = Math.max(1, Math.round(Number(args.pageNumber) || 1));

    if (call.name === "navigate_to") {
        context.jumpToPage?.(pageNumber);
        const reason =
            typeof args.reason === "string" && args.reason.trim()
                ? ` (${args.reason.trim()})`
                : "";
        const pageText = await readPageContextText(
            context.docId,
            pageNumber,
            context.jumpToPage,
        );
        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, reason: args.reason },
            status: "success",
            badgeLabel: `⚡ Navigated to Page ${pageNumber}`,
            result: pageText
                ? `Viewer navigated to Page ${pageNumber}${reason}. Page ${pageNumber} text:\n${pageText}`
                : `Viewer navigated to Page ${pageNumber}${reason}. (No extractable text found on this page yet.)`,
        };
    }

    if (call.name === "highlight_passage") {
        const passageText = String(args.text ?? "").trim();
        const color =
            typeof args.color === "string" && args.color.trim()
                ? args.color.trim()
                : "#FDE047";
        const label =
            typeof args.label === "string" && args.label.trim()
                ? args.label.trim()
                : "key finding";

        if (!context.docId || !passageText) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, text: passageText, color, label },
                status: "error",
                badgeLabel: `⚠️ Could not highlight Page ${pageNumber}`,
                result: "Missing active document ID or passage text.",
            };
        }

        const rectSegments = await resolvePassageRects(
            context.docId,
            pageNumber,
            passageText,
            context.jumpToPage,
        );

        if (rectSegments.length === 0) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, text: passageText, color, label },
                status: "error",
                badgeLabel: `⚡ Navigated to Page ${pageNumber}`,
                result: `Navigated to Page ${pageNumber}, but exact line coordinates for "${passageText.slice(0, 60)}" could not be resolved.`,
            };
        }

        const annotation: TextMarkupAnnotation = {
            id: `markup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            pageNumber,
            toolType: "highlight",
            color,
            text: passageText,
            rectSegments,
            x: rectSegments[0].x,
            y: rectSegments[0].y,
            createdAt: new Date().toISOString(),
        };

        await DocumentDatabase.appendAnnotation(context.docId, annotation);

        useAnnotationStore.getState().receiveAnnotation(annotation, context.docId);

        context.jumpToPage?.(pageNumber);
        useRagStore.getState().setActiveRagHighlight({
            chunkId: annotation.id,
            docId: context.docId,
            docTitle: context.docTitle || "Document",
            pageNumber,
            text: passageText,
            similarityScore: 1.0,
            rectSegments,
            highlightKind: "tool",
        });

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, text: passageText, color, label },
            status: "success",
            badgeLabel: `✏️ Highlighted ${label}`,
            result: `Persisted highlight annotation on Page ${pageNumber} for "${passageText.slice(0, 120)}".`,
        };
    }

    if (call.name === "explain_figure") {
        context.jumpToPage?.(pageNumber);
        const caption = typeof args.caption === "string" ? args.caption.trim() : "";

        const pageChunks = await getPageRagChunks(context.docId, pageNumber);
        const matchedChunk = findMatchingFigureChunk(pageChunks, caption);

        let pageContext = "";
        if (matchedChunk && context.docId) {
            useRagStore.getState().setActiveRagHighlight({
                chunkId: matchedChunk.chunkId,
                docId: context.docId,
                docTitle: context.docTitle || "Document",
                pageNumber,
                text: matchedChunk.text,
                similarityScore: 1.0,
                rectSegments: matchedChunk.rectSegments,
                highlightKind: "tool",
            });
            const adjacentChunks = pageChunks
                .filter((c) => c.chunkId !== matchedChunk.chunkId)
                .slice(0, 1);
            pageContext = [matchedChunk, ...adjacentChunks]
                .map((c) => c.text)
                .join("\n\n")
                .slice(0, 1800);
        } else {
            const rawPageText = await readPageContextText(
                context.docId,
                pageNumber,
                context.jumpToPage,
            );
            if (!caption) {
                pageContext = rawPageText;
            } else if (rawPageText) {
                const metrics = scoreFigureCandidate(rawPageText, caption);
                if (metrics.hasIdMatch || metrics.overlapCount >= 1) {
                    pageContext = rawPageText;
                }
            }
        }

        let visionAttached = false;
        let attachedCaption = caption;
        let cropResult: { crop: CropAnnotation; dataUrl: string } | null = null;
        if (context.supportsVision) {
            cropResult = await resolveCropForFigureExplanation({
                docId: context.docId,
                pageNumber,
                caption,
                jumpToPage: context.jumpToPage,
            });
            if (cropResult) {
                visionAttached = true;
                attachedCaption =
                    cropResult.crop.caption || caption || `Figure on Page ${pageNumber}`;
            }
        }

        if (caption && !matchedChunk && !pageContext && !visionAttached) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, caption },
                status: "error",
                badgeLabel: `⚠️ Figure not found on Page ${pageNumber}`,
                result: `Navigated to Page ${pageNumber}, but no chunk, caption, or figure matching "${caption}" was found on that page.`,
            };
        }

        const resultParts: string[] = [
            `Navigated to Page ${pageNumber}${caption ? ` (${caption})` : ""}.`,
        ];
        if (visionAttached) {
            resultParts.push(
                `Cropped figure image ("${attachedCaption}") is attached for visual inspection.`,
            );
        }
        if (caption && !matchedChunk) {
            resultParts.push(
                `Note: No indexed text chunk specifically matched "${caption}" on Page ${pageNumber}.`,
            );
        }
        if (pageContext) {
            resultParts.push(`Page context:\n${pageContext}`);
        }

        const resultText = resultParts.join(" ");
        if (cropResult && visionAttached) {
            context.onVisionImageCaptured?.({
                image: {
                    dataUrl: cropResult.dataUrl,
                    caption: attachedCaption,
                },
                context: resultText,
            });
        }

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, caption },
            status: "success",
            badgeLabel: visionAttached
                ? `🖼️ Inspected Figure on Page ${pageNumber}`
                : `🖼️ Focused Figure on Page ${pageNumber}`,
            result: resultText,
        };
    }

    if (call.name === "add_figure_to_summary") {
        const caption =
            typeof args.caption === "string" ? args.caption.trim() : undefined;
        const captured = await captureFigureCropFromPage(pageNumber, caption, {
            docId: context.docId,
            jumpToPage: context.jumpToPage,
        });

        if (!captured) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, caption },
                status: "error",
                badgeLabel: `⚠️ Could not capture figure on Page ${pageNumber}`,
                result: `Failed to locate or render canvas for Page ${pageNumber}.`,
            };
        }

        await insertFigureIntoSummary(captured.crop, context.docId);
        const label = captured.crop.caption || `Figure (Page ${pageNumber})`;
        const mdImage = formatCropMarkdown(
            label,
            captured.crop.id,
            captured.crop.imageUrl,
        );

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, caption },
            status: "success",
            badgeLabel: `📎 Added figure from Page ${pageNumber} to Summary`,
            result: `Inserted ${mdImage} into the active summary (${captured.created ? "newly captured from page canvas" : "reused existing crop"}).`,
        };
    }

    return {
        id: call.id,
        name: call.name,
        arguments: args,
        status: "error",
        badgeLabel: `⚠️ Unknown tool: ${call.name}`,
        result: `Unsupported tool "${call.name}".`,
    };
}