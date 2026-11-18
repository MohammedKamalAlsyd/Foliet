/**
 * Foliet - Multi-Provider Streaming Adapters
 */

import type { LlmProvider } from "@/types/chat";
import {
    formatMessageTextWithTools,
    splitDataUrl,
} from "@/utils/llmFormatting";
import {
    fetchWithToolFallback,
    parseErrorResponse,
    streamNdjson,
    streamSse,
} from "./stream";
import { parseToolArgs, toOpenAiTools } from "./tools";
import type {
    LlmToolCall,
    StreamChatOptions,
    VisionImageInput,
} from "./types";

export const PROVIDER_NAMES: Record<LlmProvider, string> = {
    openrouter: "OpenRouter",
    openai: "OpenAI",
    anthropic: "Anthropic",
    "google-ai-studio": "Google AI Studio",
    ollama: "Ollama",
};

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

function getLastUserIndex(messages: Array<{ role: string }>): number {
    return messages.reduce((acc, m, idx) => (m.role === "user" ? idx : acc), -1);
}

function resolveVisionImages(
    provider: LlmProvider,
    model: string,
    options: StreamChatOptions,
): VisionImageInput[] | null {
    if (!options.visionImages?.length || !isVisionCapableModel(provider, model)) {
        return null;
    }
    return options.visionImages;
}

function emitOrderedToolCalls(
    accum: Map<number, { id: string; name: string; argsJson: string }>,
    onToolCalls?: (calls: LlmToolCall[]) => void,
): void {
    if (accum.size === 0 || !onToolCalls) return;
    const calls = Array.from(accum.entries())
        .sort((a, b) => a[0] - b[0])
        .filter(([, entry]) => entry.name.trim().length > 0)
        .map(([, entry]) => ({
            id: entry.id,
            name: entry.name.trim(),
            arguments: parseToolArgs(entry.argsJson),
        }));
    if (calls.length > 0) onToolCalls(calls);
}

// =============================================================================
// OpenAI & OpenRouter (Shared OpenAI-Compatible Adapter)
// =============================================================================

async function streamOpenAiCompatible(
    config: {
        provider: "openrouter" | "openai";
        url: string;
        extraHeaders?: Record<string, string>;
        allowWebSearch?: boolean;
    },
    model: string,
    apiKey: string,
    options: StreamChatOptions,
): Promise<string> {
    const vision = resolveVisionImages(config.provider, model, options);
    const lastUserIdx = getLastUserIndex(options.messages);

    const messages: Array<{ role: string; content: any }> = [];
    if (options.systemPrompt?.trim()) {
        messages.push({ role: "system", content: options.systemPrompt.trim() });
    }

    options.messages.forEach((msg, idx) => {
        const text = formatMessageTextWithTools(msg);
        if (vision && idx === lastUserIdx) {
            const parts: any[] = [{ type: "text", text }];
            for (const img of vision) {
                if (img.caption) {
                    parts.push({
                        type: "text",
                        text: `[Figure Reference: ${img.caption}]`,
                    });
                }
                parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
            }
            messages.push({ role: msg.role, content: parts });
        } else {
            messages.push({ role: msg.role, content: text });
        }
    });

    const openAiTools = toOpenAiTools(options.tools);
    const sendReq = (includeTools: boolean) => {
        const payload: Record<string, any> = { model, messages, stream: true };
        if (config.allowWebSearch && options.webSearchEnabled) {
            payload.plugins = [{ id: "web" }];
        }
        if (includeTools && openAiTools) {
            payload.tools = openAiTools;
            payload.tool_choice = "auto";
        }
        return fetch(config.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey.trim()}`,
                ...config.extraHeaders,
            },
            body: JSON.stringify(payload),
            signal: options.signal,
        });
    };

    const response = await fetchWithToolFallback(
        sendReq,
        Boolean(openAiTools),
        PROVIDER_NAMES[config.provider],
    );

    let fullText = "";
    const toolCallAccum = new Map<
        number,
        { id: string; name: string; argsJson: string }
    >();

    await streamSse(response, options.signal, (data) => {
        if (data === "[DONE]") return;
        try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (typeof delta?.content === "string" && delta.content) {
                fullText += delta.content;
                options.onChunk(delta.content);
            }
            if (Array.isArray(delta?.tool_calls)) {
                for (const tc of delta.tool_calls) {
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
            // Ignore malformed or incomplete frames
        }
    });

    emitOrderedToolCalls(toolCallAccum, options.onToolCalls);
    return fullText;
}

// =============================================================================
// Anthropic
// =============================================================================

async function streamAnthropic(
    model: string,
    apiKey: string,
    options: StreamChatOptions,
): Promise<string> {
    const filtered = options.messages.filter(
        (m) => m.role === "user" || m.role === "assistant",
    );
    const vision = resolveVisionImages("anthropic", model, options);
    const lastUserIdx = getLastUserIndex(filtered);

    const messages = filtered.map((m, idx) => {
        const text = formatMessageTextWithTools(m);
        if (!vision || idx !== lastUserIdx) return { role: m.role, content: text };

        const blocks: any[] = [{ type: "text", text }];
        for (const img of vision) {
            const split = splitDataUrl(img.dataUrl);
            if (!split) continue;
            if (img.caption) {
                blocks.push({ type: "text", text: `[Figure Reference: ${img.caption}]` });
            }
            blocks.push({
                type: "image",
                source: { type: "base64", media_type: split.mimeType, data: split.base64 },
            });
        }
        return { role: m.role, content: blocks };
    });

    const payload: Record<string, any> = {
        model,
        max_tokens: 4096,
        messages,
        stream: true,
    };
    if (options.systemPrompt?.trim()) payload.system = options.systemPrompt.trim();
    if (options.tools?.length) {
        payload.tools = options.tools.map((t) => ({
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
        body: JSON.stringify(payload),
        signal: options.signal,
    });

    if (!response.ok) {
        throw new Error(await parseErrorResponse(response, "Anthropic"));
    }

    let fullText = "";
    const toolBlocks = new Map<
        number,
        { id: string; name: string; argsJson: string }
    >();

    await streamSse(response, options.signal, (data) => {
        try {
            const parsed = JSON.parse(data);
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
                    if (entry) entry.argsJson += parsed.delta.partial_json;
                }
            }
        } catch {
            // Ignore non-JSON frames
        }
    });

    emitOrderedToolCalls(toolBlocks, options.onToolCalls);
    return fullText;
}

// =============================================================================
// Google AI Studio (Gemini)
// =============================================================================

async function streamGoogleAiStudio(
    model: string,
    apiKey: string,
    options: StreamChatOptions,
): Promise<string> {
    const filtered = options.messages.filter(
        (m) => m.role === "user" || m.role === "assistant",
    );
    const vision = resolveVisionImages("google-ai-studio", model, options);
    const lastUserIdx = getLastUserIndex(filtered);

    const contents = filtered.map((m, idx) => {
        const parts: any[] = [{ text: formatMessageTextWithTools(m) }];
        if (vision && idx === lastUserIdx) {
            for (const img of vision) {
                const split = splitDataUrl(img.dataUrl);
                if (!split) continue;
                if (img.caption) {
                    parts.push({ text: `[Figure Reference: ${img.caption}]` });
                }
                parts.push({
                    inlineData: { mimeType: split.mimeType, data: split.base64 },
                });
            }
        }
        return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    const payload: Record<string, any> = { contents };
    if (options.systemPrompt?.trim()) {
        payload.systemInstruction = { parts: [{ text: options.systemPrompt.trim() }] };
    }
    if (options.tools?.length) {
        payload.tools = [{ functionDeclarations: options.tools }];
    }

    const cleanModel = model.replace(/^models\//, "");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        cleanModel,
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey.trim())}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: options.signal,
    });

    if (!response.ok) {
        throw new Error(await parseErrorResponse(response, "Google AI Studio"));
    }

    let fullText = "";
    const toolCalls: LlmToolCall[] = [];

    await streamSse(response, options.signal, (data) => {
        try {
            const parsed = JSON.parse(data);
            const parts = parsed.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts)) return;
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
        } catch {
            // Ignore malformed frames
        }
    });

    if (toolCalls.length > 0) options.onToolCalls?.(toolCalls);
    return fullText;
}

// =============================================================================
// Ollama (Local)
// =============================================================================

async function streamOllama(
    model: string,
    endpoint: string,
    options: StreamChatOptions,
): Promise<string> {
    const vision = resolveVisionImages("ollama", model, options);
    const lastUserIdx = getLastUserIndex(options.messages);

    const messages: Array<{ role: string; content: string; images?: string[] }> = [];
    if (options.systemPrompt?.trim()) {
        messages.push({ role: "system", content: options.systemPrompt.trim() });
    }

    options.messages.forEach((msg, idx) => {
        const entry: { role: string; content: string; images?: string[] } = {
            role: msg.role,
            content: formatMessageTextWithTools(msg),
        };
        if (vision && idx === lastUserIdx) {
            const rawImages = vision
                .map((img) => splitDataUrl(img.dataUrl)?.base64)
                .filter((b): b is string => Boolean(b));
            if (rawImages.length > 0) entry.images = rawImages;
        }
        messages.push(entry);
    });

    const baseUrl = endpoint.replace(/\/+$/, "");
    const openAiTools = toOpenAiTools(options.tools);

    const safeFetch = async (includeTools: boolean) => {
        const payload: Record<string, any> = { model, messages, stream: true };
        if (includeTools && openAiTools) payload.tools = openAiTools;
        try {
            return await fetch(`${baseUrl}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: options.signal,
            });
        } catch (err: any) {
            if (options.signal?.aborted || err?.name === "AbortError") throw err;
            throw new Error(
                `Unable to connect to Ollama at ${baseUrl}. Ensure Ollama is running and accessible.`,
            );
        }
    };

    const response = await fetchWithToolFallback(
        safeFetch,
        Boolean(openAiTools),
        "Ollama",
    );

    let fullText = "";
    const toolCalls: LlmToolCall[] = [];

    await streamNdjson(response, options.signal, (line) => {
        const raw = line.startsWith("data:") ? line.slice(5).trim() : line;
        try {
            const parsed = JSON.parse(raw);
            const delta = parsed.message?.content;
            if (typeof delta === "string" && delta) {
                fullText += delta;
                options.onChunk(delta);
            }
            if (Array.isArray(parsed.message?.tool_calls)) {
                for (const tc of parsed.message.tool_calls) {
                    if (!tc.function?.name) continue;
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
        } catch {
            // Ignore unparseable lines
        }
    });

    if (toolCalls.length > 0) options.onToolCalls?.(toolCalls);
    return fullText;
}

// =============================================================================
// Provider Dispatcher
// =============================================================================

export function dispatchProviderStream(params: {
    provider: LlmProvider;
    model: string;
    apiKey: string;
    ollamaEndpoint: string;
    options: StreamChatOptions;
}): Promise<string> {
    const { provider, model, apiKey, ollamaEndpoint, options } = params;
    switch (provider) {
        case "openrouter":
            return streamOpenAiCompatible(
                {
                    provider: "openrouter",
                    url: "https://openrouter.ai/api/v1/chat/completions",
                    extraHeaders: {
                        "HTTP-Referer": "https://foliet.app",
                        "X-Title": "Foliet",
                    },
                    allowWebSearch: true,
                },
                model,
                apiKey,
                options,
            );
        case "openai":
            return streamOpenAiCompatible(
                { provider: "openai", url: "https://api.openai.com/v1/chat/completions" },
                model,
                apiKey,
                options,
            );
        case "anthropic":
            return streamAnthropic(model, apiKey, options);
        case "google-ai-studio":
            return streamGoogleAiStudio(model, apiKey, options);
        case "ollama":
            return streamOllama(model, ollamaEndpoint, options);
        default:
            throw new Error(`Unsupported LLM provider: ${provider}`);
    }
}