/**
 * Foliet - Vercel AI SDK Copilot & Summary Tool Builders
 */

import { jsonSchema, tool, type ToolSet } from "ai";
import { captureFigureCropFromPage } from "@/services/figureCropper";
import type { ExecutedToolCall } from "@/types/chat";
import {
    type CopilotToolContext,
    executeCopilotToolCall,
} from "@/utils/chatTools";
import { formatCropMarkdown, resolveCropUri } from "@/utils/llmFormatting";
import { fetchRangeText } from "@/utils/summaryUtils";

export interface SummaryToolContext {
    docId: string;
    pdfProxy: any | null;
    jumpToPage?: (page: number) => void;
    onToolExecuted?: () => void;
}

const pageNumberSchema = {
    type: "integer" as const,
    description: "1-indexed PDF page number.",
};

export function buildCopilotTools(
    context: CopilotToolContext,
    onToolExecuted?: (call: ExecutedToolCall) => void,
): ToolSet {
    const run = async (
        id: string,
        name: string,
        args: Record<string, unknown>,
    ): Promise<string> => {
        const executed = await executeCopilotToolCall(
            { id, name, arguments: args },
            context,
        );
        onToolExecuted?.(executed);
        return executed.result;
    };

    return {
        navigate_to: tool({
            description:
                "Scroll and jump the user's PDF viewer to a specific page number and read that page's text content.",
            inputSchema: jsonSchema<{ pageNumber: number; reason?: string }>({
                type: "object",
                properties: {
                    pageNumber: pageNumberSchema,
                    reason: {
                        type: "string",
                        description: "Brief explanation of what is on that page.",
                    },
                },
                required: ["pageNumber"],
                additionalProperties: false,
            }),
            execute: (args, { toolCallId }) => run(toolCallId, "navigate_to", args),
        }),

        highlight_passage: tool({
            description:
                "Create a persistent highlight annotation on a key passage or finding on a specific PDF page.",
            inputSchema: jsonSchema<{
                pageNumber: number;
                text: string;
                color?: string;
                label?: string;
            }>({
                type: "object",
                properties: {
                    pageNumber: pageNumberSchema,
                    text: {
                        type: "string",
                        description:
                            "Exact or distinctive excerpt of the passage to highlight.",
                    },
                    color: {
                        type: "string",
                        description: "Optional hex highlight color, e.g. #FDE047 or #93C5FD.",
                    },
                    label: {
                        type: "string",
                        description:
                            "Short label for the highlight badge, e.g. 'key finding'.",
                    },
                },
                required: ["pageNumber", "text"],
                additionalProperties: false,
            }),
            execute: (args, { toolCallId }) =>
                run(toolCallId, "highlight_passage", args),
        }),

        explain_figure: tool({
            description:
                "Navigate to a PDF page containing a figure or diagram and inspect its surrounding text to explain it.",
            inputSchema: jsonSchema<{ pageNumber: number; caption?: string }>({
                type: "object",
                properties: {
                    pageNumber: pageNumberSchema,
                    caption: {
                        type: "string",
                        description: "Figure number or caption text to focus on.",
                    },
                },
                required: ["pageNumber"],
                additionalProperties: false,
            }),
            execute: (args, { toolCallId }) =>
                run(toolCallId, "explain_figure", args),
        }),

        add_figure_to_summary: tool({
            description:
                "Capture a figure, chart, or diagram from a specific PDF page (reusing an existing crop if present, or auto-cropping around its caption) and insert it into the active living summary.",
            inputSchema: jsonSchema<{ pageNumber: number; caption?: string }>({
                type: "object",
                properties: {
                    pageNumber: pageNumberSchema,
                    caption: {
                        type: "string",
                        description:
                            "Figure label or caption text on the page (e.g. 'Figure 2' or 'System architecture').",
                    },
                },
                required: ["pageNumber"],
                additionalProperties: false,
            }),
            execute: (args, { toolCallId }) =>
                run(toolCallId, "add_figure_to_summary", args),
        }),
    };
}

export function buildSummaryTools(context: SummaryToolContext): ToolSet {
    return {
        navigate_to: tool({
            description:
                "Jump to a specific PDF page and read its text content for summary synthesis.",
            inputSchema: jsonSchema<{ pageNumber: number }>({
                type: "object",
                properties: { pageNumber: pageNumberSchema },
                required: ["pageNumber"],
                additionalProperties: false,
            }),
            execute: async ({ pageNumber }) => {
                context.onToolExecuted?.();
                const pageNum = Math.max(1, Math.round(pageNumber || 1));
                context.jumpToPage?.(pageNum);
                const text = await fetchRangeText(
                    context.docId,
                    context.pdfProxy,
                    pageNum,
                    pageNum,
                );
                return text
                    ? `Page ${pageNum} text:\n${text}`
                    : `Navigated to Page ${pageNum}.`;
            },
        }),

        add_figure_to_summary: tool({
            description:
                "Capture a figure from a PDF page and return its Markdown image tag to embed directly in the updated summary.",
            inputSchema: jsonSchema<{ pageNumber: number; caption?: string }>({
                type: "object",
                properties: {
                    pageNumber: pageNumberSchema,
                    caption: {
                        type: "string",
                        description: "Optional figure label or caption text on the page.",
                    },
                },
                required: ["pageNumber"],
                additionalProperties: false,
            }),
            execute: async ({ pageNumber, caption }) => {
                context.onToolExecuted?.();
                const pageNum = Math.max(1, Math.round(pageNumber || 1));
                const captured = await captureFigureCropFromPage(
                    pageNum,
                    caption?.trim() || undefined,
                    { docId: context.docId, jumpToPage: context.jumpToPage },
                );
                if (!captured) {
                    return `Could not capture figure on Page ${pageNum}.`;
                }
                const uri = resolveCropUri(captured.crop.id, captured.crop.imageUrl);
                const alt = captured.crop.caption || `Figure (Page ${pageNum})`;
                return `Captured figure on Page ${pageNum}. Embed it in the updated Markdown using: ${formatCropMarkdown(alt, captured.crop.id, uri)}`;
            },
        }),
    };
}