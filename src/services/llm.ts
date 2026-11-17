/**
 * Foliet - LLM Streaming Service
 *
 * Implements direct streaming chat completions across multiple LLM providers:
 * - OpenRouter (with optional live Web Search plugin)
 * - OpenAI
 * - Anthropic
 * - Google AI Studio (Gemini)
 * - Ollama (local)
 *
 * Supports SSE / NDJSON stream parsing, AbortController cancellation,
 * LLM function calling / tool schemas, multimodal vision inputs,
 * and academic prompt construction for RAG and document summarization.
 */

import { SettingsStorage, type AiSettings } from "@/services/storage/settings";
import type { LlmProvider, ChatMessage } from "@/types/chat";

export interface LlmToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface LlmToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface VisionImageInput {
    dataUrl: string;
    caption?: string;
}

export interface StreamChatOptions {
    messages: ChatMessage[];
    systemPrompt?: string;
    onChunk: (chunk: string) => void;
    onToolCalls?: (toolCalls: LlmToolCall[]) => void;
    tools?: LlmToolDefinition[];
    webSearchEnabled?: boolean;
    visionImages?: VisionImageInput[];
    signal?: AbortSignal;
    provider?: LlmProvider;
    model?: string;
    apiKey?: string;
    ollamaEndpoint?: string;
}

export interface RagPromptContextItem {
    text: string;
    pageNumber: number;
    docTitle?: string;
}

export type SummaryFocusMode = "executive" | "study" | "technical";

export interface SummaryHighlightInput {
    pageNumber: number;
    toolType: "highlight" | "underline" | "strikethrough";
    text: string;
}

export interface SummaryNoteInput {
    pageNumber: number;
    comment: string;
    contextSnippet?: string;
}

export interface SummaryCropInput {
    id: string;
    pageNumber: number;
    imageUrl: string;
    caption?: string;
    resolvedDataUrl?: string;
}

export interface SummaryChatTakeawayInput {
    title: string;
    excerpts: string[];
}

export interface StructuredSummaryInput {
    docTitle: string;
    focusMode: SummaryFocusMode;
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
    fallbackExcerpt?: string;
}

export interface ChapterSummaryInput {
    docTitle: string;
    chapterTitle: string;
    startPage: number;
    endPage: number;
    focusMode: SummaryFocusMode;
    chapterText: string;
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
}

export interface ModifySummaryInput {
    docTitle: string;
    focusMode: SummaryFocusMode;
    existingMarkdown: string;
    instruction: string;
    chapterContext?: {
        title: string;
        startPage: number;
        endPage: number;
        text: string;
    };
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
}

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

const PROVIDER_NAMES: Record<LlmProvider, string> = {
    openrouter: "OpenRouter",
    openai: "OpenAI",
    anthropic: "Anthropic",
    "google-ai-studio": "Google AI Studio",
    ollama: "Ollama",
};

function parseToolArgs(raw: string): Record<string, any> {
    if (!raw || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
        return {};
    }
}

function splitDataUrl(
    dataUrl: string,
): { mimeType: string; base64: string } | null {
    const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) return null;
    return { mimeType: match[1], base64: match[2] };
}

function formatMessageTextWithTools(msg: ChatMessage): string {
    if (!msg.toolCalls || msg.toolCalls.length === 0) return msg.content;
    // Keep tool results compact and non-mimetic so models answer in prose instead of copying tool-call syntax
    const toolNotes = msg.toolCalls
        .map((tc) => `[Tool action completed (${tc.badgeLabel}): ${tc.result}]`)
        .join("\n");
    return msg.content ? `${msg.content}\n\n${toolNotes}` : toolNotes;
}

export function isVisionCapableModel(
    provider: LlmProvider,
    model: string,
): boolean {
    const m = model.toLowerCase();
    if (provider === "anthropic" || provider === "google-ai-studio") return true;
    if (provider === "openai") {
        return (
            m.includes("gpt-4o") ||
            m.includes("gpt-4.1") ||
            m.includes("gpt-5") ||
            m.includes("gpt-6") ||
            m.includes("vision")
        );
    }
    if (provider === "openrouter") {
        return (
            m.includes("claude") ||
            m.includes("gemini") ||
            m.includes("gpt-4o") ||
            m.includes("gpt-4.1") ||
            m.includes("gpt-5") ||
            m.includes("gpt-6") ||
            m.includes("vl") ||
            m.includes("vision") ||
            m.includes("gemma")
        );
    }
    if (provider === "ollama") {
        return (
            m.includes("gemma4") ||
            m.includes("gemma3") ||
            m.includes("llava") ||
            m.includes("vision") ||
            m.includes("qwen2.5vl") ||
            m.includes("qwen3.5") ||
            m.includes("minicpm-v")
        );
    }
    return false;
}

/**
 * Reads lines from a ReadableStream reader safely handling multibyte chunk boundaries.
 */
async function streamLines(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal | undefined,
    onLine: (line: string) => void,
): Promise<void> {
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    try {
        while (true) {
            if (signal?.aborted) {
                await reader.cancel();
                throw new DOMException("The operation was aborted.", "AbortError");
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                onLine(line);
            }
        }

        if (buffer.trim().length > 0) {
            onLine(buffer);
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Extracts a descriptive error message from an HTTP error response.
 */
async function parseErrorResponse(
    response: Response,
    providerName: string,
): Promise<string> {
    try {
        const errorJson = await response.json();
        const msg =
            errorJson?.error?.message ||
            errorJson?.message ||
            errorJson?.error ||
            (typeof errorJson === "string" ? errorJson : null);
        if (msg) return `[${providerName}] ${response.status}: ${msg}`;
    } catch {
        // Fall back to plain text
    }

    try {
        const text = await response.text();
        if (text)
            return `[${providerName}] ${response.status}: ${text.slice(0, 300)}`;
    } catch {
        // Ignore
    }

    return `[${providerName}] Request failed with status ${response.status} (${response.statusText})`;
}

export class LlmService {
    /**
     * Streams completions from the configured or specified LLM provider.
     * Returns a promise resolving to the full accumulated text.
     */
    public static async streamChat(options: StreamChatOptions): Promise<string> {
        const aiSettings = await SettingsStorage.getAiSettings();
        const provider = options.provider ?? aiSettings.llmProvider;
        const model = options.model ?? aiSettings.llmModel;
        const apiKey = options.apiKey ?? aiSettings.apiKeys[provider] ?? "";
        const ollamaEndpoint =
            options.ollamaEndpoint ??
            aiSettings.ollamaEndpoint ??
            "http://localhost:11434";
        const webSearchEnabled =
            options.webSearchEnabled ??
            Boolean(
                (aiSettings as AiSettings & { webSearchEnabled?: boolean })
                    .webSearchEnabled,
            );

        const providerName = PROVIDER_NAMES[provider] || provider;

        // API Key validation
        if (provider !== "ollama" && (!apiKey || !apiKey.trim())) {
            throw new Error(
                `API key for ${providerName} is not configured. Please add your API key in Settings.`,
            );
        }

        const effectiveOptions: StreamChatOptions = {
            ...options,
            webSearchEnabled,
        };

        switch (provider) {
            case "openrouter":
                return this.streamOpenRouter(model, apiKey, effectiveOptions);
            case "openai":
                return this.streamOpenAi(model, apiKey, effectiveOptions);
            case "anthropic":
                return this.streamAnthropic(model, apiKey, effectiveOptions);
            case "google-ai-studio":
                return this.streamGoogleAiStudio(model, apiKey, effectiveOptions);
            case "ollama":
                return this.streamOllama(model, ollamaEndpoint, effectiveOptions);
            default:
                throw new Error(`Unsupported LLM provider: ${provider}`);
        }
    }

    // =========================================================================
    // OpenAI-compatible Message & Tool Helpers (OpenRouter / OpenAI)
    // =========================================================================

    private static buildOpenAiMessages(
        options: StreamChatOptions,
        includeVision: boolean,
    ): Array<{ role: string; content: any }> {
        const formattedMessages: Array<{ role: string; content: any }> = [];
        if (options.systemPrompt?.trim()) {
            formattedMessages.push({
                role: "system",
                content: options.systemPrompt.trim(),
            });
        }

        const lastUserIdx = options.messages.reduce(
            (acc, m, idx) => (m.role === "user" ? idx : acc),
            -1,
        );

        options.messages.forEach((msg, idx) => {
            const text = formatMessageTextWithTools(msg);
            if (
                includeVision &&
                idx === lastUserIdx &&
                options.visionImages &&
                options.visionImages.length > 0
            ) {
                const contentParts: any[] = [{ type: "text", text }];
                for (const img of options.visionImages) {
                    if (img.caption) {
                        contentParts.push({
                            type: "text",
                            text: `[Figure Reference: ${img.caption}]`,
                        });
                    }
                    contentParts.push({
                        type: "image_url",
                        image_url: { url: img.dataUrl },
                    });
                }
                formattedMessages.push({ role: msg.role, content: contentParts });
            } else {
                formattedMessages.push({ role: msg.role, content: text });
            }
        });

        return formattedMessages;
    }

    private static async parseOpenAiStream(
        response: Response,
        options: StreamChatOptions,
    ): Promise<string> {
        if (!response.body) {
            throw new Error("No response body received.");
        }

        let fullText = "";
        const toolCallAccum = new Map<
            number,
            { id: string; name: string; argsJson: string }
        >();

        await streamLines(response.body.getReader(), options.signal, (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) return;

            const dataStr = trimmed.slice(5).trim();
            if (dataStr === "[DONE]") return;

            try {
                const parsed = JSON.parse(dataStr);
                const choiceDelta = parsed.choices?.[0]?.delta;
                const delta = choiceDelta?.content;
                if (typeof delta === "string" && delta) {
                    fullText += delta;
                    options.onChunk(delta);
                }

                if (Array.isArray(choiceDelta?.tool_calls)) {
                    for (const tc of choiceDelta.tool_calls) {
                        const idx = typeof tc.index === "number" ? tc.index : 0;
                        const entry = toolCallAccum.get(idx) ?? {
                            id: tc.id || crypto.randomUUID(),
                            name: "",
                            argsJson: "",
                        };
                        if (tc.id) entry.id = tc.id;
                        if (tc.function?.name) entry.name += tc.function.name;
                        if (typeof tc.function?.arguments === "string") {
                            entry.argsJson += tc.function.arguments;
                        }
                        toolCallAccum.set(idx, entry);
                    }
                }
            } catch {
                // Ignore incomplete SSE frames
            }
        });

        if (toolCallAccum.size > 0 && options.onToolCalls) {
            const calls: LlmToolCall[] = Array.from(toolCallAccum.entries())
                .sort((a, b) => a[0] - b[0])
                .filter(([, entry]) => entry.name.trim().length > 0)
                .map(([, entry]) => ({
                    id: entry.id,
                    name: entry.name.trim(),
                    arguments: parseToolArgs(entry.argsJson),
                }));
            if (calls.length > 0) {
                options.onToolCalls(calls);
            }
        }

        return fullText;
    }

    // =========================================================================
    // OpenRouter
    // =========================================================================

    private static async streamOpenRouter(
        model: string,
        apiKey: string,
        options: StreamChatOptions,
    ): Promise<string> {
        const includeVision =
            Boolean(options.visionImages?.length) &&
            isVisionCapableModel("openrouter", model);

        const buildPayload = (includeTools: boolean) => {
            const payload: Record<string, any> = {
                model,
                messages: this.buildOpenAiMessages(options, includeVision),
                stream: true,
            };
            if (options.webSearchEnabled) {
                payload.plugins = [{ id: "web" }];
            }
            if (includeTools && options.tools && options.tools.length > 0) {
                payload.tools = options.tools.map((t) => ({
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    },
                }));
                payload.tool_choice = "auto";
            }
            return payload;
        };

        const sendReq = (includeTools: boolean) =>
            fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey.trim()}`,
                    "HTTP-Referer": "https://foliet.app",
                    "X-Title": "Foliet",
                },
                body: JSON.stringify(buildPayload(includeTools)),
                signal: options.signal,
            });

        let response = await sendReq(Boolean(options.tools?.length));

        // Graceful fallback if the selected OpenRouter model does not support tool calling
        if (!response.ok && response.status === 400 && options.tools?.length) {
            const errText = await response
                .clone()
                .text()
                .catch(() => "");
            if (/tool|function/i.test(errText)) {
                response = await sendReq(false);
            }
        }

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "OpenRouter"));
        }

        return this.parseOpenAiStream(response, options);
    }

    // =========================================================================
    // OpenAI
    // =========================================================================

    private static async streamOpenAi(
        model: string,
        apiKey: string,
        options: StreamChatOptions,
    ): Promise<string> {
        const includeVision =
            Boolean(options.visionImages?.length) &&
            isVisionCapableModel("openai", model);

        const buildPayload = (includeTools: boolean) => {
            const payload: Record<string, any> = {
                model,
                messages: this.buildOpenAiMessages(options, includeVision),
                stream: true,
            };
            if (includeTools && options.tools && options.tools.length > 0) {
                payload.tools = options.tools.map((t) => ({
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    },
                }));
                payload.tool_choice = "auto";
            }
            return payload;
        };

        const sendReq = (includeTools: boolean) =>
            fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey.trim()}`,
                },
                body: JSON.stringify(buildPayload(includeTools)),
                signal: options.signal,
            });

        let response = await sendReq(Boolean(options.tools?.length));
        if (!response.ok && response.status === 400 && options.tools?.length) {
            const errText = await response
                .clone()
                .text()
                .catch(() => "");
            if (/tool|function/i.test(errText)) {
                response = await sendReq(false);
            }
        }

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "OpenAI"));
        }

        return this.parseOpenAiStream(response, options);
    }

    // =========================================================================
    // Anthropic
    // =========================================================================

    private static async streamAnthropic(
        model: string,
        apiKey: string,
        options: StreamChatOptions,
    ): Promise<string> {
        const filtered = options.messages.filter(
            (m) => m.role === "user" || m.role === "assistant",
        );
        const lastUserIdx = filtered.reduce(
            (acc, m, idx) => (m.role === "user" ? idx : acc),
            -1,
        );
        const includeVision =
            Boolean(options.visionImages?.length) &&
            isVisionCapableModel("anthropic", model);

        const anthropicMessages = filtered.map((m, idx) => {
            const text = formatMessageTextWithTools(m);
            if (
                includeVision &&
                idx === lastUserIdx &&
                options.visionImages &&
                options.visionImages.length > 0
            ) {
                const blocks: any[] = [{ type: "text", text }];
                for (const img of options.visionImages) {
                    const split = splitDataUrl(img.dataUrl);
                    if (split) {
                        if (img.caption) {
                            blocks.push({
                                type: "text",
                                text: `[Figure Reference: ${img.caption}]`,
                            });
                        }
                        blocks.push({
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: split.mimeType,
                                data: split.base64,
                            },
                        });
                    }
                }
                return { role: m.role, content: blocks };
            }
            return { role: m.role, content: text };
        });

        const bodyPayload: Record<string, any> = {
            model,
            max_tokens: 4096,
            messages: anthropicMessages,
            stream: true,
        };

        if (options.systemPrompt?.trim()) {
            bodyPayload.system = options.systemPrompt.trim();
        }
        if (options.tools && options.tools.length > 0) {
            bodyPayload.tools = options.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
            }));
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey.trim(),
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
            },
            body: JSON.stringify(bodyPayload),
            signal: options.signal,
        });

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "Anthropic"));
        }

        if (!response.body) {
            throw new Error("[Anthropic] No response body received.");
        }

        let fullText = "";
        const toolBlocks = new Map<
            number,
            { id: string; name: string; argsJson: string }
        >();

        await streamLines(response.body.getReader(), options.signal, (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) return;

            const dataStr = trimmed.slice(5).trim();
            try {
                const parsed = JSON.parse(dataStr);
                if (
                    parsed.type === "content_block_start" &&
                    parsed.content_block?.type === "tool_use"
                ) {
                    const idx = typeof parsed.index === "number" ? parsed.index : 0;
                    toolBlocks.set(idx, {
                        id: parsed.content_block.id || crypto.randomUUID(),
                        name: parsed.content_block.name || "",
                        argsJson: "",
                    });
                } else if (parsed.type === "content_block_delta") {
                    if (
                        parsed.delta?.type === "text_delta" &&
                        typeof parsed.delta.text === "string"
                    ) {
                        fullText += parsed.delta.text;
                        options.onChunk(parsed.delta.text);
                    } else if (
                        parsed.delta?.type === "input_json_delta" &&
                        typeof parsed.delta.partial_json === "string"
                    ) {
                        const idx = typeof parsed.index === "number" ? parsed.index : 0;
                        const entry = toolBlocks.get(idx);
                        if (entry) {
                            entry.argsJson += parsed.delta.partial_json;
                        }
                    }
                }
            } catch {
                // Ignore non-JSON lines or keep-alive frames
            }
        });

        if (toolBlocks.size > 0 && options.onToolCalls) {
            const calls: LlmToolCall[] = Array.from(toolBlocks.entries())
                .sort((a, b) => a[0] - b[0])
                .filter(([, entry]) => entry.name.trim().length > 0)
                .map(([, entry]) => ({
                    id: entry.id,
                    name: entry.name.trim(),
                    arguments: parseToolArgs(entry.argsJson),
                }));
            if (calls.length > 0) {
                options.onToolCalls(calls);
            }
        }

        return fullText;
    }

    // =========================================================================
    // Google AI Studio (Gemini)
    // =========================================================================

    private static async streamGoogleAiStudio(
        model: string,
        apiKey: string,
        options: StreamChatOptions,
    ): Promise<string> {
        const filtered = options.messages.filter(
            (m) => m.role === "user" || m.role === "assistant",
        );
        const lastUserIdx = filtered.reduce(
            (acc, m, idx) => (m.role === "user" ? idx : acc),
            -1,
        );
        const includeVision =
            Boolean(options.visionImages?.length) &&
            isVisionCapableModel("google-ai-studio", model);

        const contents = filtered.map((m, idx) => {
            const parts: any[] = [{ text: formatMessageTextWithTools(m) }];
            if (
                includeVision &&
                idx === lastUserIdx &&
                options.visionImages &&
                options.visionImages.length > 0
            ) {
                for (const img of options.visionImages) {
                    const split = splitDataUrl(img.dataUrl);
                    if (split) {
                        if (img.caption) {
                            parts.push({
                                text: `[Figure Reference: ${img.caption}]`,
                            });
                        }
                        parts.push({
                            inlineData: {
                                mimeType: split.mimeType,
                                data: split.base64,
                            },
                        });
                    }
                }
            }
            return {
                role: m.role === "assistant" ? "model" : "user",
                parts,
            };
        });

        const bodyPayload: Record<string, any> = { contents };

        if (options.systemPrompt?.trim()) {
            bodyPayload.systemInstruction = {
                parts: [{ text: options.systemPrompt.trim() }],
            };
        }
        if (options.tools && options.tools.length > 0) {
            bodyPayload.tools = [
                {
                    functionDeclarations: options.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    })),
                },
            ];
        }

        const cleanModel = model.replace(/^models\//, "");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            cleanModel,
        )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey.trim())}`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(bodyPayload),
            signal: options.signal,
        });

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "Google AI Studio"));
        }

        if (!response.body) {
            throw new Error("[Google AI Studio] No response body received.");
        }

        let fullText = "";
        const toolCalls: LlmToolCall[] = [];

        await streamLines(response.body.getReader(), options.signal, (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) return;

            const dataStr = trimmed.slice(5).trim();
            try {
                const parsed = JSON.parse(dataStr);
                const parts = parsed.candidates?.[0]?.content?.parts;
                if (Array.isArray(parts)) {
                    for (const part of parts) {
                        if (typeof part.text === "string" && part.text) {
                            fullText += part.text;
                            options.onChunk(part.text);
                        }
                        if (part.functionCall?.name) {
                            toolCalls.push({
                                id: crypto.randomUUID(),
                                name: part.functionCall.name,
                                arguments: part.functionCall.args || {},
                            });
                        }
                    }
                }
            } catch {
                // Ignore incomplete SSE frames
            }
        });

        if (toolCalls.length > 0 && options.onToolCalls) {
            options.onToolCalls(toolCalls);
        }

        return fullText;
    }

    // =========================================================================
    // Ollama (Local)
    // =========================================================================

    private static async streamOllama(
        model: string,
        endpoint: string,
        options: StreamChatOptions,
    ): Promise<string> {
        const includeVision =
            Boolean(options.visionImages?.length) &&
            isVisionCapableModel("ollama", model);

        const formattedMessages: Array<{
            role: string;
            content: string;
            images?: string[];
        }> = [];
        if (options.systemPrompt?.trim()) {
            formattedMessages.push({
                role: "system",
                content: options.systemPrompt.trim(),
            });
        }

        const lastUserIdx = options.messages.reduce(
            (acc, m, idx) => (m.role === "user" ? idx : acc),
            -1,
        );

        options.messages.forEach((msg, idx) => {
            const entry: { role: string; content: string; images?: string[] } = {
                role: msg.role,
                content: formatMessageTextWithTools(msg),
            };
            if (
                includeVision &&
                idx === lastUserIdx &&
                options.visionImages &&
                options.visionImages.length > 0
            ) {
                const rawImages = options.visionImages
                    .map((img) => splitDataUrl(img.dataUrl)?.base64)
                    .filter((b): b is string => Boolean(b));
                if (rawImages.length > 0) {
                    entry.images = rawImages;
                }
            }
            formattedMessages.push(entry);
        });

        const baseUrl = endpoint.replace(/\/+$/, "");
        const chatUrl = `${baseUrl}/api/chat`;

        const sendReq = (includeTools: boolean) => {
            const payload: Record<string, any> = {
                model,
                messages: formattedMessages,
                stream: true,
            };
            if (includeTools && options.tools && options.tools.length > 0) {
                payload.tools = options.tools.map((t) => ({
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    },
                }));
            }
            return fetch(chatUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
                signal: options.signal,
            });
        };

        let response: Response;
        try {
            response = await sendReq(Boolean(options.tools?.length));
            // Graceful fallback when local Ollama model does not support tools
            if (!response.ok && response.status === 400 && options.tools?.length) {
                const errText = await response
                    .clone()
                    .text()
                    .catch(() => "");
                if (/tool|support/i.test(errText)) {
                    response = await sendReq(false);
                }
            }
        } catch (fetchErr: any) {
            if (options.signal?.aborted || fetchErr?.name === "AbortError") {
                throw fetchErr;
            }
            throw new Error(
                `Unable to connect to Ollama at ${baseUrl}. Ensure Ollama is running and accessible.`,
            );
        }

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "Ollama"));
        }

        if (!response.body) {
            throw new Error("[Ollama] No response body received.");
        }

        let fullText = "";
        const toolCalls: LlmToolCall[] = [];

        await streamLines(response.body.getReader(), options.signal, (line) => {
            let trimmed = line.trim();
            if (!trimmed) return;
            if (trimmed.startsWith("data:")) {
                trimmed = trimmed.slice(5).trim();
            }

            try {
                const parsed = JSON.parse(trimmed);
                const delta = parsed.message?.content;
                if (typeof delta === "string" && delta) {
                    fullText += delta;
                    options.onChunk(delta);
                }
                if (Array.isArray(parsed.message?.tool_calls)) {
                    for (const tc of parsed.message.tool_calls) {
                        if (tc.function?.name) {
                            const args =
                                typeof tc.function.arguments === "string"
                                    ? parseToolArgs(tc.function.arguments)
                                    : tc.function.arguments || {};
                            toolCalls.push({
                                id: tc.id || crypto.randomUUID(),
                                name: tc.function.name,
                                arguments: args,
                            });
                        }
                    }
                }
            } catch {
                // Ignore unparseable lines
            }
        });

        if (toolCalls.length > 0 && options.onToolCalls) {
            options.onToolCalls(toolCalls);
        }

        return fullText;
    }

    // =========================================================================
    // Prompt Helpers
    // =========================================================================

    /**
     * Constructs a grounded scholarly system prompt injecting retrieved RAG excerpts with citation instructions.
     */
    public static buildRagSystemPrompt(
        chunks: RagPromptContextItem[],
        docTitle?: string,
        toolsEnabled?: boolean,
    ): string {
        const formattedPassages = chunks
            .map((chunk, index) => {
                const title = chunk.docTitle || docTitle || "Current Document";
                return `--- PASSAGE ${index + 1} [Source: "${title}", Page ${chunk.pageNumber}] ---\n${chunk.text.trim()}`;
            })
            .join("\n\n");

        const toolNote = toolsEnabled
            ? [
                "5. COPILOT TOOLS: You have tools to interact with the PDF viewer (`navigate_to`, `highlight_passage`, `explain_figure`, `add_figure_to_summary`). Calling `navigate_to` or `explain_figure` also returns that page's text so you can read it, and `add_figure_to_summary` captures a page figure and inserts it into the living summary. Never print raw tool logs or JSON tool syntax in your final response.",
            ]
            : [];

        return [
            `You are Foliet's scholarly research assistant (Lio). The user currently has the document "${docTitle || "Current PDF"}" open in the PDF viewer.`,
            "Your task is to provide rigorous, accurate, and insightful answers based on the retrieved document excerpts below.",
            "",
            "GUIDELINES:",
            "1. GROUNDING & FIDELITY: Base your statements directly on the provided passages. Do not extrapolate unsupported claims.",
            "2. CITATIONS: Whenever stating a finding, metric, argument, or fact from a passage, explicitly cite the source page using bracketed format, e.g., [Page X] or [Title, Page X].",
            "3. UNKNOWN / ABSENT INFO: If the provided excerpts do not contain enough information to answer a question definitively, state clearly that the retrieved excerpts do not cover that point (or call `navigate_to` to inspect an earlier/relevant page).",
            "4. SCHOLARLY TONE: Maintain a concise, academic tone. Avoid marketing hype, conversational fluff, and unnecessary adjectives.",
            ...toolNote,
            "",
            "RETRIEVED DOCUMENT EXCERPTS:",
            formattedPassages || "(No relevant passages retrieved.)",
        ].join("\n");
    }

    /**
     * Constructs a structured academic summarization prompt.
     */
    public static buildSummarizationPrompt(
        docTitle: string,
        contentSnippet?: string,
    ): string {
        return [
            `You are Foliet's scholarly research assistant. Provide an objective, structured academic summary of the paper titled "${docTitle}".`,
            "",
            "Structure your summary into the following sections:",
            "- **Core Objective & Motivation**: What central problem does this research address, and why does it matter?",
            "- **Key Methodology & Approach**: What models, algorithms, datasets, or theoretical frameworks are introduced or utilized?",
            "- **Principal Findings & Results**: What empirical metrics, key conclusions, or comparative advantages did the authors demonstrate?",
            "- **Significance & Limitations**: What are the broader implications, practical applications, or highlighted limitations?",
            "",
            "REQUIREMENTS:",
            "- Be precise, dense, and factual. Avoid vague fluff like 'this groundbreaking study'.",
            "- Use clear bullet points and bold headers.",
            contentSnippet ? `\nDOCUMENT EXCERPT / TEXT:\n${contentSnippet}` : "",
        ].join("\n");
    }

    /**
     * System-prompt preset shaping tone, formatting, and citation discipline for Living Summary synthesis & edits.
     */
    public static buildSummarySystemPrompt(
        focusMode: SummaryFocusMode,
        docTitle: string,
    ): string {
        const modeGuidance: Record<SummaryFocusMode, string> = {
            study: [
                "STYLE MODE: Study Notes",
                "- Pedagogical, clear, and structured for deep retention and review.",
                "- Define core concepts, highlight intuition alongside key facts, and end chapters with concise takeaway bullets.",
                "- Incorporate the user's personal notes and Lio Q&A clarifications where provided.",
            ].join("\n"),
            executive: [
                "STYLE MODE: Executive Brief",
                "- Crisp, high-signal, and decision-oriented.",
                "- Lead with thesis, key conclusions, empirical metrics, and practical implications or limitations.",
                "- Keep prose tight; avoid verbose step-by-step repetition.",
            ].join("\n"),
            technical: [
                "STYLE MODE: Technical & Code",
                "- Rigorous focus on system architecture, formal definitions, equations, algorithms, benchmarks, and trade-offs.",
                "- Present algorithms, mathematical formulations, protocols, or pseudocode inside fenced code blocks with explicit language tags (e.g., ```python, ```rust, ```latex).",
            ].join("\n"),
        };

        return [
            `You are Foliet's scholarly synthesis assistant maintaining a Living Summary for "${docTitle}".`,
            "",
            modeGuidance[focusMode],
            "",
            "GLOBAL OUTPUT RULES:",
            "- GROUNDING & CITATIONS: Anchor claims directly in the supplied source text and user annotations. Cite pages inline using bracketed format `[Page X]`.",
            "- FIGURES: When figure crop URIs (`idb://crop-...`) are provided, embed relevant figures on their own line using `![Concise figure description (Page X)](idb://crop-...)`. Never invent or alter image URIs.",
            "- TOOL USAGE: If the user asks to include a figure from a page that does not yet have a crop URI, you may call `add_figure_to_summary`.",
            "- OUTPUT FORMAT: Return clean, valid Markdown only—no conversational preamble or meta-commentary.",
        ].join("\n");
    }

    /**
     * Builds the user prompt for generating a single chapter section (`## Chapter Title`).
     */
    public static buildChapterSummaryPrompt(input: ChapterSummaryInput): string {
        const notesSection = this.formatSummaryContextBlocks(input);

        return [
            `Synthesize a structured Markdown summary section for the following chapter of "${input.docTitle}".`,
            `CHAPTER: "${input.chapterTitle}" (Pages ${input.startPage}–${input.endPage})`,
            "",
            `Start the output directly with the exact heading:`,
            `## ${input.chapterTitle}`,
            "",
            "Use `###` subheadings where helpful, bullet points for key mechanisms/results, and `[Page X]` citations throughout.",
            "",
            "CHAPTER TEXT / EXCERPTS:",
            input.chapterText.trim() || "(No extractable text found in this page range.)",
            notesSection,
        ].join("\n");
    }

    /**
     * Builds the user prompt for conversational modification of the existing living summary.
     */
    public static buildModifySummaryPrompt(input: ModifySummaryInput): string {
        const notesSection = this.formatSummaryContextBlocks(input);
        const chapterBlock = input.chapterContext
            ? [
                `ACTIVE CHAPTER CONTEXT: "${input.chapterContext.title}" (Pages ${input.chapterContext.startPage}–${input.chapterContext.endPage})`,
                input.chapterContext.text.trim(),
            ].join("\n")
            : "";

        return [
            "Modify or refine the EXISTING SUMMARY MARKDOWN below according to the USER INSTRUCTION.",
            "Preserve unaffected sections, headings, `[Page X]` citations, and existing `![...](idb://...)` image links unless the instruction explicitly asks to remove or rewrite them.",
            "Return the complete updated Markdown document only.",
            "",
            `USER INSTRUCTION: ${input.instruction.trim()}`,
            "",
            "EXISTING SUMMARY MARKDOWN:",
            input.existingMarkdown.trim() || "(Empty document)",
            chapterBlock ? `\n${chapterBlock}` : "",
            notesSection,
        ]
            .filter(Boolean)
            .join("\n");
    }

    private static formatSummaryContextBlocks(input: {
        highlights: SummaryHighlightInput[];
        notes: SummaryNoteInput[];
        crops: SummaryCropInput[];
        chatTakeaways: SummaryChatTakeawayInput[];
    }): string {
        const blocks: string[] = [];

        if (input.highlights.length > 0) {
            blocks.push(
                [
                    "USER HIGHLIGHTS & UNDERLINES:",
                    ...input.highlights.map(
                        (h, i) => `${i + 1}. [Page ${h.pageNumber} · ${h.toolType}] "${h.text.trim()}"`,
                    ),
                ].join("\n"),
            );
        }

        if (input.notes.length > 0) {
            blocks.push(
                [
                    "USER STICKY NOTES:",
                    ...input.notes.map((n, i) => {
                        const ctx = n.contextSnippet
                            ? ` (Context: "${n.contextSnippet.trim()}")`
                            : "";
                        return `${i + 1}. [Page ${n.pageNumber}] ${n.comment.trim()}${ctx}`;
                    }),
                ].join("\n"),
            );
        }

        if (input.crops.length > 0) {
            blocks.push(
                [
                    "AVAILABLE FIGURE CROPS IN RANGE:",
                    ...input.crops.map(
                        (c, i) =>
                            `${i + 1}. [Page ${c.pageNumber}] URI: ${c.imageUrl}${c.caption ? ` | Caption: "${c.caption.trim()}"` : ""
                            }${c.resolvedDataUrl ? " | (Visual image attached)" : ""}`,
                    ),
                ].join("\n"),
            );
        }

        if (input.chatTakeaways.length > 0) {
            blocks.push(
                [
                    "SAVED LIO CHAT TAKEAWAYS:",
                    ...input.chatTakeaways.map(
                        (c, i) =>
                            `Conversation ${i + 1}: "${c.title}"\n${c.excerpts
                                .map((e) => `  - ${e.trim()}`)
                                .join("\n")}`,
                    ),
                ].join("\n"),
            );
        }

        return blocks.length > 0 ? `\n\n${blocks.join("\n\n")}` : "";
    }

    /**
     * Constructs a personalized, source-anchored summarization prompt built around
     * the user's selected highlights, underlines, personal notes, figure crops, and chat insights.
     */
    public static buildStructuredSummarizationPrompt(
        input: StructuredSummaryInput,
    ): string {
        const focusInstructions: Record<SummaryFocusMode, string> = {
            executive: [
                "FOCUS MODE: Executive Brief",
                "Organize with clean Markdown headings:",
                "1. `# <Concise Document Title>`",
                "2. `## Thesis & Problem Statement`",
                "3. `## Core Findings & Evidence` (anchored in the user's highlighted passages)",
                "4. `## Methodology & Synthesis`",
                "5. `## Limitations & Open Questions`",
            ].join("\n"),
            study: [
                "FOCUS MODE: Study Notes",
                "Organize with clean Markdown headings:",
                "1. `# <Concise Study Title>`",
                "2. `## Core Concepts & Definitions`",
                "3. `## Detailed Walkthrough` (synthesized from the marked passages by theme or progression)",
                "4. `## Marginalia & Resolved Questions` (directly addressing the user's personal notes and Lio chat takeaways)",
                "5. `## Key Takeaways for Review`",
            ].join("\n"),
            technical: [
                "FOCUS MODE: Technical & Code",
                "Organize with clean Markdown headings:",
                "1. `# <Concise Technical Title>`",
                "2. `## System Architecture & Formalisms`",
                "3. `## Algorithms, Equations & Code` (present algorithms, data structures, mathematical formulations, or implementations inside fenced code blocks with language tags)",
                "4. `## Benchmarks & Empirical Results`",
                "5. `## Implementation Notes & Trade-offs`",
            ].join("\n"),
        };

        const highlightsBlock =
            input.highlights.length > 0
                ? input.highlights
                    .map(
                        (h, idx) =>
                            `${idx + 1}. [Page ${h.pageNumber} · ${h.toolType}] "${h.text.trim()}"`,
                    )
                    .join("\n")
                : "(No text highlights or underlines selected.)";

        const notesBlock =
            input.notes.length > 0
                ? input.notes
                    .map((n, idx) => {
                        const ctx = n.contextSnippet
                            ? ` (Context: "${n.contextSnippet.trim()}")`
                            : "";
                        return `${idx + 1}. [Page ${n.pageNumber} · User Note] ${n.comment.trim()}${ctx}`;
                    })
                    .join("\n")
                : "(No personal sticky notes selected.)";

        const cropsBlock =
            input.crops.length > 0
                ? input.crops
                    .map(
                        (c, idx) =>
                            `${idx + 1}. [Page ${c.pageNumber} · Figure Crop] URI: ${c.imageUrl}${c.caption ? ` | Caption: "${c.caption.trim()}"` : ""
                            }${c.resolvedDataUrl ? " | (Visual image attached for inspection)" : ""}`,
                    )
                    .join("\n")
                : "(No figure crops selected.)";

        const chatsBlock =
            input.chatTakeaways.length > 0
                ? input.chatTakeaways
                    .map(
                        (c, idx) =>
                            `Conversation ${idx + 1}: "${c.title}"\n${c.excerpts
                                .map((e) => `  - ${e.trim()}`)
                                .join("\n")}`,
                    )
                    .join("\n\n")
                : "(No Lio chat takeaways selected.)";

        const hasAttachedImages = input.crops.some((c) =>
            Boolean(c.resolvedDataUrl),
        );

        return [
            `You are Foliet's scholarly research assistant synthesizing personal research notes for "${input.docTitle}".`,
            "",
            focusInstructions[input.focusMode],
            "",
            "STRICT SYNTHESIS RULES:",
            "- ANCHOR ON USER MARKUPS: Center the entire document around the user's selected highlights, underlines, and personal sticky notes below. Synthesize, connect, and contextualize what the user marked rather than producing generic filler.",
            "- PAGE CITATIONS: Cite page numbers inline consistently using bracketed format `[Page X]` (e.g., `[Page 4]`).",
            "- INTEGRATE CHAT INSIGHTS: Incorporate relevant answers or clarifications from the selected Lio Chat Takeaways naturally into the synthesis.",
            "- FENCED CODE BLOCKS: Whenever explaining an algorithm, formula, protocol, pseudocode, or code structure, ALWAYS wrap it in a clean fenced code block with an explicit language tag (e.g., ```python, ```typescript, ```rust, ```latex, ```text).",
            input.crops.length > 0
                ? `- FIGURE CROPS (IMAGES): ${hasAttachedImages
                    ? "Inspect the attached figure images carefully to describe their visual data, trends, axes, and diagrams accurately. "
                    : ""
                }Embed the user's captured figure crops directly in the relevant sections on their own line using standard Markdown image syntax with the exact URI provided below, e.g., \`![Concise figure description (Page X)](idb://crop-...)\`. Never invent, modify, or shorten an image URI, and only reference URIs listed in USER FIGURE CROPS.`
                : "- Do not invent or emit image links.",
            "- OUTPUT FORMAT: Output valid Markdown only. Do not include conversational preamble or meta-commentary.",
            "",
            "USER HIGHLIGHTED & UNDERLINED PASSAGES:",
            highlightsBlock,
            "",
            "USER PERSONAL STICKY NOTES:",
            notesBlock,
            "",
            "USER CAPTURED FIGURE CROPS:",
            cropsBlock,
            "",
            "SAVED LIO CHAT TAKEAWAYS:",
            chatsBlock,
            input.fallbackExcerpt?.trim()
                ? `\nADDITIONAL DOCUMENT EXCERPTS:\n${input.fallbackExcerpt.trim()}`
                : "",
        ].join("\n");
    }
}

// Standalone function exports for convenience
export const streamChat = LlmService.streamChat.bind(LlmService);
export const buildRagSystemPrompt =
    LlmService.buildRagSystemPrompt.bind(LlmService);
export const buildSummarizationPrompt =
    LlmService.buildSummarizationPrompt.bind(LlmService);
export const buildStructuredSummarizationPrompt =
    LlmService.buildStructuredSummarizationPrompt.bind(LlmService);