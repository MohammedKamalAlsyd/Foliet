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
import type { ChatMessage, CitationReference } from "@/types/chat";
import { extractErrorMessage, isAbortError } from "@/utils/error";

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

export function formatMessageTextWithTools(msg: ChatMessage): string {
    if (!msg.toolCalls || msg.toolCalls.length === 0) return msg.content;
    const toolNotes = msg.toolCalls
        .map((tc) => `[Tool action completed (${tc.badgeLabel}): ${tc.result}]`)
        .join("\n");
    return msg.content ? `${msg.content}\n\n${toolNotes}` : toolNotes;
}

export function formatUserPromptWithSelection(
    text: string,
    snippet?: CitationReference | null,
): string {
    if (!snippet) return text;
    return `[Selected from Page ${snippet.pageNumber}: "${snippet.snippet}"]\n\n${text}`;
}

export function formatToolResultsPrompt(
    entries: string[],
    instruction: string,
): string {
    return [
        "<tool_execution_results>",
        ...entries,
        "</tool_execution_results>",
        instruction,
    ].join("\n\n");
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
    if (chunks.length === 0) return "(No relevant passages retrieved.)";
    return chunks
        .map((chunk, index) => {
            const title = chunk.docTitle || defaultDocTitle || "Current Document";
            return `--- PASSAGE ${index + 1} [Source: "${title}", Page ${chunk.pageNumber}] ---\n${chunk.text.trim()}`;
        })
        .join("\n\n");
}

export function formatSummaryContextBlocks(
    input: {
        highlights: SummaryHighlightInput[];
        notes: SummaryNoteInput[];
        crops: SummaryCropInput[];
        chatTakeaways: SummaryChatTakeawayInput[];
    },
    options?: { structuredPlaceholders?: boolean },
): string {
    const structured = Boolean(options?.structuredPlaceholders);

    const highlightsText = input.highlights.length
        ? input.highlights
            .map(
                (h, i) =>
                    `${i + 1}. [Page ${h.pageNumber} · ${h.toolType}] "${h.text.trim()}"`,
            )
            .join("\n")
        : structured
            ? "(No text highlights or underlines selected.)"
            : "";

    const notesText = input.notes.length
        ? input.notes
            .map((n, i) => {
                const ctx = n.contextSnippet
                    ? ` (Context: "${n.contextSnippet.trim()}")`
                    : "";
                const prefix = structured ? " · User Note" : "";
                return `${i + 1}. [Page ${n.pageNumber}${prefix}] ${n.comment.trim()}${ctx}`;
            })
            .join("\n")
        : structured
            ? "(No personal sticky notes selected.)"
            : "";

    const cropsText = input.crops.length
        ? input.crops
            .map((c, i) => {
                const prefix = structured ? " · Figure Crop" : "";
                const caption = c.caption ? ` | Caption: "${c.caption.trim()}"` : "";
                const visionNote = c.resolvedDataUrl
                    ? structured
                        ? " | (Visual image attached for inspection)"
                        : " | (Visual image attached)"
                    : "";
                return `${i + 1}. [Page ${c.pageNumber}${prefix}] URI: ${c.imageUrl}${caption}${visionNote}`;
            })
            .join("\n")
        : structured
            ? "(No figure crops selected.)"
            : "";

    const chatsText = input.chatTakeaways.length
        ? input.chatTakeaways
            .map(
                (c, i) =>
                    `Conversation ${i + 1}: "${c.title}"\n${c.excerpts
                        .map((e) => `  - ${e.trim()}`)
                        .join("\n")}`,
            )
            .join(structured ? "\n\n" : "\n")
        : structured
            ? "(No Lio chat takeaways selected.)"
            : "";

    const sections: Array<[string, string]> = [
        [
            structured
                ? "USER HIGHLIGHTED & UNDERLINED PASSAGES:"
                : "USER HIGHLIGHTS & UNDERLINES:",
            highlightsText,
        ],
        [
            structured ? "USER PERSONAL STICKY NOTES:" : "USER STICKY NOTES:",
            notesText,
        ],
        [
            structured
                ? "USER CAPTURED FIGURE CROPS:"
                : "AVAILABLE FIGURE CROPS IN RANGE:",
            cropsText,
        ],
        ["SAVED LIO CHAT TAKEAWAYS:", chatsText],
    ];

    const blocks = sections
        .filter(([, body]) => body.length > 0)
        .map(([header, body]) => `${header}\n${body}`);

    return blocks.join("\n\n");
}