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
import { LLM_PRESETS } from "@/constants/models";
import type { LlmModelPreset, LlmProvider } from "@/types/chat";
import { extractErrorMessage, isAbortError } from "@/utils/error";
import { splitDataUrl } from "@/utils/llmFormatting";
import type {
    StreamChatOptions,
    ToolVisionPayload,
    VisionImageInput,
} from "./types";

export const PROVIDER_NAMES: Record<LlmProvider, string> = {
    openrouter: "OpenRouter",
    openai: "OpenAI",
    anthropic: "Anthropic",
    "google-ai-studio": "Google AI Studio",
    ollama: "Ollama",
};

export function findModelPreset(
    provider: LlmProvider,
    model: string,
): LlmModelPreset | undefined {
    const normalized =
        provider === "google-ai-studio" ? model.replace(/^models\//, "") : model;
    return LLM_PRESETS[provider]?.find((preset) => preset.id === normalized);
}

export function isVisionCapableModel(
    provider: LlmProvider,
    model: string,
): boolean {
    const preset = findModelPreset(provider, model);
    if (typeof preset?.supportsVision === "boolean") {
        return preset.supportsVision;
    }

    // Fallback heuristics for custom user-entered model IDs
    const m = model.toLowerCase();
    if (provider === "anthropic" || provider === "google-ai-studio") return true;
    if (provider === "openai") {
        return /gpt-(?:4o|4\.1|5|6)|vision/.test(m);
    }
    if (provider === "openrouter") {
        return /claude|gemini|gpt-(?:4o|4\.1|5|6)|vl|vision|gemma/.test(m);
    }
    if (provider === "ollama") {
        return /gemma[34]|llava|vision|qwen2\.5vl|qwen3\.5|minicpm-v/.test(m);
    }
    return false;
}

export function resolveMaxOutputTokens(
    provider: LlmProvider,
    model: string,
): number | undefined {
    const preset = findModelPreset(provider, model);
    if (typeof preset?.maxOutputTokens === "number") {
        return preset.maxOutputTokens;
    }
    return provider === "anthropic" ? 4096 : undefined;
}

const openRouterWebSearchFetch: typeof fetch = async (input, init) => {
    if (typeof init?.body === "string") {
        try {
            const parsed = JSON.parse(init.body);
            const plugins = Array.isArray(parsed.plugins) ? parsed.plugins : [];
            if (!plugins.some((p: { id?: string } | null) => p?.id === "web")) {
                plugins.push({ id: "web" });
            }
            parsed.plugins = plugins;
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

function appendVisionFollowUpMessages(
    baseMessages: ModelMessage[],
    assistantLeadText: string,
    visionBatch: ToolVisionPayload[],
    attachImages: boolean,
): ModelMessage[] {
    const textContext = visionBatch
        .map((item) => item.context)
        .filter(Boolean)
        .join("\n\n");

    const userContent: Array<
        | { type: "text"; text: string }
        | { type: "image"; image: string; mediaType?: string }
    > = [
            {
                type: "text",
                text: attachImages
                    ? `Figure tool results and attached visual crop(s) for inspection:\n\n${textContext}`
                    : `Figure tool results:\n\n${textContext}`,
            },
        ];

    if (attachImages) {
        for (const item of visionBatch) {
            const { image } = item;
            if (image.caption) {
                userContent.push({
                    type: "text",
                    text: `[Figure Reference: ${image.caption}]`,
                });
            }
            const split = splitDataUrl(image.dataUrl);
            userContent.push(
                split
                    ? { type: "image", image: split.base64, mediaType: split.mimeType }
                    : { type: "image", image: image.dataUrl },
            );
        }
    }

    return [
        ...baseMessages,
        {
            role: "assistant",
            content:
                assistantLeadText.trim() ||
                "I have retrieved the figure context for inspection.",
        },
        {
            role: "user",
            content: userContent,
        },
    ];
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
    const visionSupported = isVisionCapableModel(provider, model);
    const vision =
        options.visionImages?.length && visionSupported ? options.visionImages : null;
    const initialMessages = buildSdkMessages(options, vision);
    const languageModel = createLanguageModel({
        provider,
        model,
        apiKey,
        ollamaEndpoint,
        webSearchEnabled:
            provider === "openrouter" && Boolean(options.webSearchEnabled),
    });
    const maxOutputTokens = resolveMaxOutputTokens(provider, model);
    const hasTools = Boolean(options.tools && Object.keys(options.tools).length > 0);
    const maxSteps = options.maxSteps ?? 3;
    const MAX_TOOL_VISION_TURNS = 2;

    const runStream = async (
        includeTools: boolean,
        activeMessages: ModelMessage[],
        visionTurn = 0,
    ): Promise<string> => {
        let progressed = false;
        let fullText = "";

        const stopWhen =
            includeTools && hasTools
                ? options.hasPendingToolVision && visionTurn < MAX_TOOL_VISION_TURNS
                    ? [
                        stepCountIs(Math.max(1, maxSteps - visionTurn)),
                        () => Boolean(options.hasPendingToolVision?.()),
                    ]
                    : stepCountIs(Math.max(1, maxSteps - visionTurn))
                : undefined;

        try {
            const result = streamText({
                model: languageModel,
                system: options.systemPrompt?.trim() || undefined,
                messages: activeMessages,
                tools: includeTools ? options.tools : undefined,
                stopWhen,
                maxOutputTokens,
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

            const capturedVision = options.consumePendingToolVision?.() ?? [];
            if (
                capturedVision.length > 0 &&
                visionTurn < MAX_TOOL_VISION_TURNS &&
                !options.signal?.aborted
            ) {
                if (fullText.length > 0 && !fullText.endsWith("\n")) {
                    options.onChunk("\n\n");
                    fullText += "\n\n";
                }
                const followUpMessages = appendVisionFollowUpMessages(
                    activeMessages,
                    fullText,
                    capturedVision,
                    visionSupported,
                );
                const followUpText = await runStream(
                    includeTools,
                    followUpMessages,
                    visionTurn + 1,
                );
                fullText += followUpText;
            }

            return fullText;
        } catch (err) {
            if (isAbortError(err, options.signal)) throw err;
            if (
                visionTurn === 0 &&
                includeTools &&
                hasTools &&
                !progressed &&
                isToolUnsupportedError(err)
            ) {
                return runStream(false, activeMessages, 0);
            }
            throw formatProviderError(err, provider);
        }
    };

    return runStream(hasTools, initialMessages, 0);
}