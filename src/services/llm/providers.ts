/**
 * Foliet - Multi-Provider Vercel AI SDK Streaming Adapters
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
    APICallError,
    stepCountIs,
    streamText,
    type ModelMessage,
} from "ai";
import type { LlmProvider } from "@/types/chat";
import { extractErrorMessage, isAbortError } from "@/utils/error";
import { splitDataUrl } from "@/utils/llmFormatting";
import type { StreamChatOptions, VisionImageInput } from "./types";

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

const openRouterWebSearchFetch: typeof fetch = async (input, init) => {
    if (typeof init?.body === "string") {
        try {
            const parsed = JSON.parse(init.body);
            parsed.plugins = [{ id: "web" }];
            return fetch(input, { ...init, body: JSON.stringify(parsed) });
        } catch {
            // Fall through with original body
        }
    }
    return fetch(input, init);
};

function normalizeOllamaBase(endpoint: string): string {
    return endpoint.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function createOllamaFetch(endpoint: string): typeof fetch {
    const baseUrl = normalizeOllamaBase(endpoint);
    return async (input, init) => {
        try {
            return await fetch(input, init);
        } catch (err: any) {
            if (init?.signal?.aborted || err?.name === "AbortError") throw err;
            throw new Error(
                `Unable to connect to Ollama at ${baseUrl}. Ensure Ollama is running and accessible.`,
            );
        }
    };
}

function createLanguageModel(params: {
    provider: LlmProvider;
    model: string;
    apiKey: string;
    ollamaEndpoint: string;
    webSearchEnabled?: boolean;
}) {
    const { provider, model, apiKey, ollamaEndpoint, webSearchEnabled } = params;
    switch (provider) {
        case "openrouter":
            return createOpenAICompatible({
                name: "openrouter",
                baseURL: "https://openrouter.ai/api/v1",
                apiKey: apiKey.trim(),
                headers: {
                    "HTTP-Referer": "https://foliet.app",
                    "X-Title": "Foliet",
                },
                fetch: webSearchEnabled ? openRouterWebSearchFetch : undefined,
            })(model);
        case "openai":
            return createOpenAI({ apiKey: apiKey.trim() }).chat(model);
        case "anthropic":
            return createAnthropic({
                apiKey: apiKey.trim(),
                headers: { "anthropic-dangerous-direct-browser-access": "true" },
            })(model);
        case "google-ai-studio":
            return createGoogleGenerativeAI({ apiKey: apiKey.trim() })(
                model.replace(/^models\//, ""),
            );
        case "ollama":
            return createOpenAICompatible({
                name: "ollama",
                baseURL: `${normalizeOllamaBase(ollamaEndpoint)}/v1`,
                apiKey: "ollama",
                fetch: createOllamaFetch(ollamaEndpoint),
            })(model);
        default:
            throw new Error(`Unsupported LLM provider: ${provider}`);
    }
}

function buildSdkMessages(
    options: StreamChatOptions,
    vision: VisionImageInput[] | null,
): ModelMessage[] {
    const filtered = options.messages.filter(
        (m) => m.role === "user" || m.role === "assistant",
    );
    const lastUserIdx = filtered.reduce(
        (acc, m, idx) => (m.role === "user" ? idx : acc),
        -1,
    );

    return filtered.map((m, idx): ModelMessage => {
        if (m.role === "assistant") {
            return { role: "assistant", content: m.content };
        }
        if (!vision || idx !== lastUserIdx) {
            return { role: "user", content: m.content };
        }

        const content: Array<
            | { type: "text"; text: string }
            | { type: "image"; image: string; mediaType?: string }
        > = [{ type: "text", text: m.content }];

        for (const img of vision) {
            if (img.caption) {
                content.push({
                    type: "text",
                    text: `[Figure Reference: ${img.caption}]`,
                });
            }
            const split = splitDataUrl(img.dataUrl);
            content.push(
                split
                    ? { type: "image", image: split.base64, mediaType: split.mimeType }
                    : { type: "image", image: img.dataUrl },
            );
        }
        return { role: "user", content };
    });
}

function isToolUnsupportedError(err: unknown): boolean {
    if (APICallError.isInstance(err) && err.statusCode === 400) {
        return /tool|function|support/i.test(
            `${err.message} ${err.responseBody ?? ""}`,
        );
    }
    const msg = extractErrorMessage(err, "");
    return /\b400\b/.test(msg) && /tool|function|support/i.test(msg);
}

function formatProviderError(err: unknown, provider: LlmProvider): Error {
    if (APICallError.isInstance(err)) {
        const status = err.statusCode ? `${err.statusCode}: ` : "";
        return new Error(`[${PROVIDER_NAMES[provider]}] ${status}${err.message}`);
    }
    if (err instanceof Error) return err;
    return new Error(extractErrorMessage(err, "LLM request failed."));
}

export async function dispatchProviderStream(params: {
    provider: LlmProvider;
    model: string;
    apiKey: string;
    ollamaEndpoint: string;
    options: StreamChatOptions;
}): Promise<string> {
    const { provider, model, apiKey, ollamaEndpoint, options } = params;
    const vision =
        options.visionImages?.length && isVisionCapableModel(provider, model)
            ? options.visionImages
            : null;
    const messages = buildSdkMessages(options, vision);
    const languageModel = createLanguageModel({
        provider,
        model,
        apiKey,
        ollamaEndpoint,
        webSearchEnabled: options.webSearchEnabled,
    });
    const hasTools = Boolean(options.tools && Object.keys(options.tools).length > 0);

    const runStream = async (includeTools: boolean): Promise<string> => {
        let progressed = false;
        let fullText = "";

        try {
            const result = streamText({
                model: languageModel,
                system: options.systemPrompt?.trim() || undefined,
                messages,
                tools: includeTools ? options.tools : undefined,
                stopWhen:
                    includeTools && hasTools
                        ? stepCountIs(options.maxSteps ?? 3)
                        : undefined,
                maxOutputTokens: provider === "anthropic" ? 4096 : undefined,
                abortSignal: options.signal,
            });

            for await (const part of result.fullStream) {
                if (part.type === "text-delta") {
                    const delta = part.text;
                    if (delta) {
                        progressed = true;
                        fullText += delta;
                        options.onChunk(delta);
                    }
                } else if (part.type === "tool-call") {
                    progressed = true;
                } else if (part.type === "error") {
                    throw part.error instanceof Error
                        ? part.error
                        : new Error(
                            extractErrorMessage(part.error, "LLM streaming failed."),
                        );
                }
            }
            return fullText;
        } catch (err) {
            if (isAbortError(err, options.signal)) throw err;
            if (includeTools && hasTools && !progressed && isToolUnsupportedError(err)) {
                return runStream(false);
            }
            throw formatProviderError(err, provider);
        }
    };

    return runStream(hasTools);
}