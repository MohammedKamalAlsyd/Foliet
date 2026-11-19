import type {
    SummaryChatTakeawayInput,
    SummaryCropInput,
    SummaryFocusMode,
    SummaryHighlightInput,
    SummaryNoteInput,
    VisionImageInput,
} from "@/services/llm/types";
import { PdfService } from "@/services/pdf";
import { DocumentDatabase } from "@/services/storage/database";
import {
    isCropAnnotation,
    isNoteAnnotation,
    isTextMarkupAnnotation,
    type PdfAnnotation,
} from "@/types/annotations";
import type { ChatConversation } from "@/types/chat";
import type { PdfChapter } from "@/types/document";
import { resolveCropUri } from "@/utils/llmFormatting";
import { buildChapterSummaryPrompt } from "@/utils/llmPrompts";
import { getPageRagChunks } from "@/utils/pdfDom";

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
    if (crops.length === 0) return { enrichedCrops: crops, visionImages: [] };

    const enrichedCrops = await Promise.all(
        crops.map(async (crop) => {
            if (crop.resolvedDataUrl?.startsWith("data:")) return crop;
            if (crop.imageUrl.startsWith("data:")) {
                return { ...crop, resolvedDataUrl: crop.imageUrl };
            }
            if (/^(idb:\/\/|db:\/\/|crop-)/.test(crop.imageUrl)) {
                const dataUrl = await DocumentDatabase.getFigureCrop(crop.imageUrl).catch(
                    () => null,
                );
                if (dataUrl?.startsWith("data:")) {
                    return { ...crop, resolvedDataUrl: dataUrl };
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
                imageUrl: resolveCropUri(a.id, a.imageUrl),
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
    const rangeChunks = await getPageRagChunks(docId, startPage, endPage);
    if (rangeChunks.length > 0) {
        return rangeChunks
            .map((c) => `[Page ${c.pageNumber}] ${c.text.trim()}`)
            .join("\n\n")
            .slice(0, 20_000);
    }
    return PdfService.extractPageRangeText(pdfProxy, startPage, endPage, 18_000);
}

export async function prepareChapterPromptData(params: {
    docId: string;
    docTitle: string;
    chapter: PdfChapter;
    pdfProxy: any | null;
    focusMode: SummaryFocusMode;
    annotations: PdfAnnotation[];
    conversations: ChatConversation[];
    includeNotes: boolean;
    includeChats: boolean;
    webSearchEnabled?: boolean;
}) {
    const chapterText = await fetchRangeText(
        params.docId,
        params.pdfProxy,
        params.chapter.startPage,
        params.chapter.endPage,
    );
    const ctx = collectRangeContext(params.annotations, params.conversations, {
        startPage: params.chapter.startPage,
        endPage: params.chapter.endPage,
        includeNotes: params.includeNotes,
        includeChats: params.includeChats,
    });
    const { enrichedCrops, visionImages } = await resolveCropsForVision(ctx.crops);
    const prompt = buildChapterSummaryPrompt({
        docTitle: params.docTitle,
        chapterTitle: params.chapter.title,
        startPage: params.chapter.startPage,
        endPage: params.chapter.endPage,
        focusMode: params.focusMode,
        chapterText,
        highlights: ctx.highlights,
        notes: ctx.notes,
        crops: enrichedCrops,
        chatTakeaways: ctx.chatTakeaways,
        includeNotes: params.includeNotes,
        includeChats: params.includeChats,
        webSearchEnabled: params.webSearchEnabled,
    });
    return { prompt, visionImages };
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
    const match = new RegExp(`^##\\s+${escaped}\\s*$`, "im").exec(base);
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