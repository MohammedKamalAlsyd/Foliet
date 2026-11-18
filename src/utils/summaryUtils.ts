import { captureFigureCropFromPage } from "@/services/figureCropper";
import type {
    LlmToolCall,
    SummaryChatTakeawayInput,
    SummaryCropInput,
    SummaryHighlightInput,
    SummaryNoteInput,
    VisionImageInput,
} from "@/services/llm";
import { PdfService } from "@/services/pdf";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import {
    isCropAnnotation,
    isNoteAnnotation,
    isTextMarkupAnnotation,
    type PdfAnnotation,
} from "@/types/annotations";
import type { ChatConversation } from "@/types/chat";

export interface AiSummaryState {
    content: string;
    sourceSnapshot?: string;
    updatedAt: number;
}

const backupKey = (docId: string) => `foliet:summary-prev:${docId}`;

export function readPreviousSummaryBackup(docId: string): AiSummaryState | null {
    try {
        const raw = localStorage.getItem(backupKey(docId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as AiSummaryState;
        return typeof parsed?.content === "string" && parsed.content.trim().length > 0
            ? parsed
            : null;
    } catch {
        return null;
    }
}

export function writePreviousSummaryBackup(
    docId: string,
    summary: AiSummaryState | null,
): void {
    try {
        if (!summary || !summary.content.trim()) {
            localStorage.removeItem(backupKey(docId));
        } else {
            localStorage.setItem(backupKey(docId), JSON.stringify(summary));
        }
    } catch {
        // Ignore storage quota errors
    }
}

export async function resolvePreviousSnapshot(
    docId: string,
    inMemory: AiSummaryState | null,
): Promise<AiSummaryState | null> {
    const existing = inMemory?.content?.trim()
        ? inMemory
        : await DocumentDatabase.getSummary(docId).catch(() => null);
    if (!existing?.content?.trim()) return null;

    const snapshot: AiSummaryState = {
        content: existing.content,
        sourceSnapshot: existing.sourceSnapshot,
        updatedAt: existing.updatedAt || Date.now(),
    };
    writePreviousSummaryBackup(docId, snapshot);
    return snapshot;
}

export async function resolveCropsForVision(crops: SummaryCropInput[]): Promise<{
    enrichedCrops: SummaryCropInput[];
    visionImages: VisionImageInput[];
}> {
    if (crops.length === 0) {
        return { enrichedCrops: crops, visionImages: [] };
    }

    const enrichedCrops = await Promise.all(
        crops.map(async (crop) => {
            if (crop.resolvedDataUrl?.startsWith("data:")) return crop;
            if (crop.imageUrl.startsWith("data:")) {
                return { ...crop, resolvedDataUrl: crop.imageUrl };
            }
            if (/^(idb:\/\/|db:\/\/|crop-)/.test(crop.imageUrl)) {
                try {
                    const dataUrl = await DocumentDatabase.getFigureCrop(crop.imageUrl);
                    if (dataUrl?.startsWith("data:")) {
                        return { ...crop, resolvedDataUrl: dataUrl };
                    }
                } catch {
                    // Fall back to URI/caption-only reference
                }
            }
            return crop;
        }),
    );

    const visionImages: VisionImageInput[] = enrichedCrops
        .filter((c) => Boolean(c.resolvedDataUrl))
        .map((c) => ({
            dataUrl: c.resolvedDataUrl as string,
            caption: c.caption
                ? `Page ${c.pageNumber}: ${c.caption}`
                : `Figure crop from Page ${c.pageNumber} (${c.imageUrl})`,
        }));

    return { enrichedCrops, visionImages };
}

export function collectRangeContext(
    annotations: PdfAnnotation[],
    conversations: ChatConversation[],
    options: {
        startPage?: number;
        endPage?: number;
        includeNotes: boolean;
        includeChats: boolean;
    },
): {
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
} {
    const inRange = (page: number) =>
        options.startPage === undefined ||
        options.endPage === undefined ||
        (page >= options.startPage && page <= options.endPage);

    const highlights: SummaryHighlightInput[] = [];
    const notes: SummaryNoteInput[] = [];
    const crops: SummaryCropInput[] = [];

    for (const a of annotations) {
        if (!inRange(a.pageNumber)) continue;

        if (isCropAnnotation(a)) {
            crops.push({
                id: a.id,
                pageNumber: a.pageNumber,
                imageUrl: a.imageUrl.startsWith("idb://") ? a.imageUrl : `idb://${a.id}`,
                caption: a.caption,
            });
        } else if (options.includeNotes) {
            if (isTextMarkupAnnotation(a) && a.text.trim()) {
                highlights.push({
                    pageNumber: a.pageNumber,
                    toolType: a.toolType,
                    text: a.text,
                });
            } else if (isNoteAnnotation(a) && a.comment.trim()) {
                notes.push({
                    pageNumber: a.pageNumber,
                    comment: a.comment,
                    contextSnippet: a.contextSnippet,
                });
            }
        }
    }

    const chatTakeaways: SummaryChatTakeawayInput[] = options.includeChats
        ? conversations
            .filter((c) => c.messages.length > 0)
            .slice(0, 6)
            .map((c) => ({
                title: c.title,
                excerpts: c.messages
                    .filter((m) => m.content.trim().length > 0)
                    .slice(-6)
                    .map(
                        (m) =>
                            `${m.role === "user" ? "Question" : "Lio"}: ${m.content
                                .trim()
                                .slice(0, 600)}`,
                    ),
            }))
        : [];

    return { highlights, notes, crops, chatTakeaways };
}

export async function fetchRangeText(
    docId: string,
    pdfProxy: any | null,
    startPage: number,
    endPage: number,
): Promise<string> {
    try {
        const chunks = await RagService.getDocumentChunks(docId);
        const rangeChunks = chunks
            .filter((c) => c.pageNumber >= startPage && c.pageNumber <= endPage)
            .sort((a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex);

        if (rangeChunks.length > 0) {
            return rangeChunks
                .map((c) => `[Page ${c.pageNumber}] ${c.text.trim()}`)
                .join("\n\n")
                .slice(0, 20_000);
        }
    } catch {
        // Fall back to direct PDF text extraction below
    }

    return PdfService.extractPageRangeText(pdfProxy, startPage, endPage, 18_000);
}

export function upsertChapterSection(
    existingMarkdown: string,
    docTitle: string,
    chapterTitle: string,
    sectionContent: string,
): string {
    const base = existingMarkdown.trim();
    const trimmedSection = sectionContent.trim();
    const cleanSection = !trimmedSection
        ? `## ${chapterTitle}\n`
        : /^##\s+/m.test(trimmedSection)
            ? trimmedSection
            : `## ${chapterTitle}\n\n${trimmedSection}`;

    if (!base) return `# ${docTitle}\n\n${cleanSection}\n`;

    const escaped = chapterTitle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const headingRe = new RegExp(`^##\\s+${escaped}\\s*$`, "im");
    const match = headingRe.exec(base);

    if (!match) return `${base}\n\n${cleanSection}\n`;

    const startIdx = match.index;
    const afterHeadingIdx = startIdx + match[0].length;
    const nextHeadingMatch = /^##\s+/m.exec(base.slice(afterHeadingIdx));
    const endIdx = nextHeadingMatch
        ? afterHeadingIdx + nextHeadingMatch.index
        : base.length;

    const before = base.slice(0, startIdx).trimEnd();
    const after = base.slice(endIdx).trimStart();

    return [before, cleanSection, after].filter(Boolean).join("\n\n") + "\n";
}

export async function executeSummaryToolCalls(
    calls: LlmToolCall[],
    context: {
        docId: string;
        pdfProxy: any | null;
        initialVision: VisionImageInput[];
        jumpToPage?: (page: number) => void;
    },
): Promise<{ toolResults: string[]; extraVision: VisionImageInput[] }> {
    const toolResults: string[] = [];
    const extraVision = [...context.initialVision];

    for (const call of calls) {
        const pageNum = Math.max(1, Math.round(Number(call.arguments?.pageNumber) || 1));

        if (call.name === "add_figure_to_summary") {
            const caption =
                typeof call.arguments?.caption === "string"
                    ? call.arguments.caption.trim()
                    : undefined;
            const captured = await captureFigureCropFromPage(pageNum, caption, {
                docId: context.docId,
                jumpToPage: context.jumpToPage,
            });
            if (captured) {
                const uri = captured.crop.imageUrl.startsWith("idb://")
                    ? captured.crop.imageUrl
                    : `idb://${captured.crop.id}`;
                const alt = captured.crop.caption || `Figure (Page ${pageNum})`;
                const dataUrl = await DocumentDatabase.getFigureCrop(uri);
                if (dataUrl) {
                    extraVision.push({ dataUrl, caption: `Page ${pageNum}: ${alt}` });
                }
                toolResults.push(
                    `Captured figure on Page ${pageNum}. Embed it in the updated Markdown using: ![${alt}](${uri})`,
                );
            } else {
                toolResults.push(`Could not capture figure on Page ${pageNum}.`);
            }
        } else if (call.name === "navigate_to") {
            context.jumpToPage?.(pageNum);
            const text = await fetchRangeText(
                context.docId,
                context.pdfProxy,
                pageNum,
                pageNum,
            );
            toolResults.push(
                text ? `Page ${pageNum} text:\n${text}` : `Navigated to Page ${pageNum}.`,
            );
        }
    }

    return { toolResults, extraVision };
}