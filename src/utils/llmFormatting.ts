/**
 * Foliet - LLM Message, Response, Tool & Context Formatters
 */

import type {
    RagPromptContextItem,
    SummaryChatTakeawayInput,
    SummaryCropInput,
    SummaryHighlightInput,
    SummaryNoteInput,
} from "@/services/llm/types";
import type { CitationReference } from "@/types/chat";
import { extractErrorMessage, isAbortError } from "@/utils/error";
import { compressRagPassages } from "@/utils/tokenCompressor";

export function splitDataUrl(
    dataUrl: string,
): { mimeType: string; base64: string } | null {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    return match ? { mimeType: match[1], base64: match[2] } : null;
}

export function resolveCropUri(id: string, imageUrl?: string): string {
    if (imageUrl?.startsWith("idb://")) return imageUrl;
    return `idb://${id.replace(/^idb:\/\//, "")}`;
}

export function formatCropMarkdown(
    alt: string,
    id: string,
    imageUrl?: string,
): string {
    return `![${alt}](${resolveCropUri(id, imageUrl)})`;
}

export function formatUserPromptWithSelection(
    text: string,
    snippet?: CitationReference | null,
): string {
    if (!snippet) return text;
    return `[Selected from Page ${snippet.pageNumber}: "${snippet.snippet}"]\n\n${text}`;
}

export function formatStreamErrorOutput(
    accumulated: string,
    err: unknown,
    signal?: AbortSignal,
): string {
    if (isAbortError(err, signal)) return accumulated;
    const message = extractErrorMessage(err, "Unknown error");
    return accumulated.length > 0
        ? `${accumulated}\n\n[Generation stopped: ${message}]`
        : `[Error: ${message}]`;
}

export function formatRagPassages(
    chunks: RagPromptContextItem[],
    defaultDocTitle?: string,
): string {
    return compressRagPassages(chunks, defaultDocTitle);
}

/**
 * Formats non-empty optional user context (highlights, notes, crops, chat takeaways)
 * in a compact, deduplicated format. Empty sections are always omitted so the model
 * never complains about missing highlights or notes.
 */
export function formatSummaryContextBlocks(input: {
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
}): string {
    // Deduplicate highlights with identical normalized text
    const seenHighlights = new Set<string>();
    const uniqueHighlights = input.highlights.filter((h) => {
        const key = h.text.replace(/\s+/g, " ").trim().toLowerCase();
        if (!key || seenHighlights.has(key)) return false;
        seenHighlights.add(key);
        return true;
    });

    const highlightsText = uniqueHighlights
        .map((h) => `- [Page ${h.pageNumber}] "${h.text.replace(/\s+/g, " ").trim()}"`)
        .join("\n");

    const notesText = input.notes
        .map((n) => {
            const ctx = n.contextSnippet
                ? ` (re: "${n.contextSnippet.replace(/\s+/g, " ").trim().slice(0, 140)}")`
                : "";
            return `- [Page ${n.pageNumber}] ${n.comment.replace(/\s+/g, " ").trim()}${ctx}`;
        })
        .join("\n");

    const cropsText = input.crops
        .map((c) => {
            const cap = c.caption ? ` | "${c.caption.trim()}"` : "";
            const vis = c.resolvedDataUrl ? " | image attached" : "";
            return `- [Page ${c.pageNumber}] ${c.imageUrl}${cap}${vis}`;
        })
        .join("\n");

    const chatsText = input.chatTakeaways
        .map(
            (c) =>
                `- ${c.title}: ${c.excerpts
                    .map((e) => e.replace(/\s+/g, " ").trim().slice(0, 260))
                    .join(" | ")}`,
        )
        .join("\n");

    const sections: Array<[string, string]> = [
        ["OPTIONAL USER HIGHLIGHTS:", highlightsText],
        ["OPTIONAL USER NOTES:", notesText],
        ["FIGURES:", cropsText],
        ["OPTIONAL CHAT TAKEAWAYS:", chatsText],
    ];

    return sections
        .filter(([, body]) => body.length > 0)
        .map(([header, body]) => `${header}\n${body}`)
        .join("\n\n");
}
