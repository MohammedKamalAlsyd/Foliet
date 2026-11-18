/**
 * Foliet - Copilot Tool Definitions & Helpers
 */

import type { LlmToolDefinition } from "./types";

export const FOLIET_TOOL_DEFINITIONS: LlmToolDefinition[] = [
    {
        name: "navigate_to",
        description:
            "Scroll and jump the user's PDF viewer to a specific page number and read that page's text content.",
        parameters: {
            type: "object",
            properties: {
                pageNumber: {
                    type: "integer",
                    description: "1-indexed PDF page number to navigate to.",
                },
                reason: {
                    type: "string",
                    description: "Brief explanation of what is on that page.",
                },
            },
            required: ["pageNumber"],
        },
    },
    {
        name: "highlight_passage",
        description:
            "Create a persistent highlight annotation on a key passage or finding on a specific PDF page.",
        parameters: {
            type: "object",
            properties: {
                pageNumber: {
                    type: "integer",
                    description: "1-indexed PDF page number containing the passage.",
                },
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
        },
    },
    {
        name: "explain_figure",
        description:
            "Navigate to a PDF page containing a figure or diagram and inspect its surrounding text to explain it.",
        parameters: {
            type: "object",
            properties: {
                pageNumber: {
                    type: "integer",
                    description: "1-indexed PDF page number where the figure appears.",
                },
                caption: {
                    type: "string",
                    description: "Figure number or caption text to focus on.",
                },
            },
            required: ["pageNumber"],
        },
    },
    {
        name: "add_figure_to_summary",
        description:
            "Capture a figure, chart, or diagram from a specific PDF page (reusing an existing crop if present, or auto-cropping around its caption) and insert it into the active living summary.",
        parameters: {
            type: "object",
            properties: {
                pageNumber: {
                    type: "integer",
                    description: "1-indexed PDF page number containing the figure.",
                },
                caption: {
                    type: "string",
                    description:
                        "Figure label or caption text on the page (e.g. 'Figure 2' or 'System architecture').",
                },
            },
            required: ["pageNumber"],
        },
    },
];

export function parseToolArgs(raw: string): Record<string, any> {
    if (!raw || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

export function toOpenAiTools(tools?: LlmToolDefinition[]) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        },
    }));
}