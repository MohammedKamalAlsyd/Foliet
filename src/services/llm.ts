/**
 * Foliet - LLM Streaming Service
 *
 * Implements direct streaming chat completions across multiple LLM providers:
 * - OpenRouter
 * - OpenAI
 * - Anthropic
 * - Google AI Studio (Gemini)
 * - Ollama (local)
 *
 * Handles SSE / NDJSON stream parsing, AbortController cancellation,
 * and academic prompt construction for RAG and document summarization.
 */

import { SettingsStorage } from "@/services/storage/settings";
import type { LlmProvider, ChatMessage } from "@/types/chat";

export interface StreamChatOptions {
    messages: ChatMessage[];
    systemPrompt?: string;
    onChunk: (chunk: string) => void;
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

const PROVIDER_NAMES: Record<LlmProvider, string> = {
    openrouter: "OpenRouter",
    openai: "OpenAI",
    anthropic: "Anthropic",
    "google-ai-studio": "Google AI Studio",
    ollama: "Ollama",
};

/**
 * Reads lines from a ReadableStream reader safely handling multibyte chunk boundaries.
 */
async function streamLines(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal | undefined,
    onLine: (line: string) => void
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
async function parseErrorResponse(response: Response, providerName: string): Promise<string> {
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
        if (text) return `[${providerName}] ${response.status}: ${text.slice(0, 300)}`;
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
        const ollamaEndpoint = options.ollamaEndpoint ?? aiSettings.ollamaEndpoint ?? "http://localhost:11434";

        const providerName = PROVIDER_NAMES[provider] || provider;

        // API Key validation
        if (provider !== "ollama" && (!apiKey || !apiKey.trim())) {
            throw new Error(
                `API key for ${providerName} is not configured. Please add your API key in Settings.`
            );
        }

        switch (provider) {
            case "openrouter":
                return this.streamOpenRouter(model, apiKey, options);
            case "openai":
                return this.streamOpenAi(model, apiKey, options);
            case "anthropic":
                return this.streamAnthropic(model, apiKey, options);
            case "google-ai-studio":
                return this.streamGoogleAiStudio(model, apiKey, options);
            case "ollama":
                return this.streamOllama(model, ollamaEndpoint, options);
            default:
                throw new Error(`Unsupported LLM provider: ${provider}`);
        }
    }

    // =========================================================================
    // OpenRouter
    // =========================================================================

    private static async streamOpenRouter(
        model: string,
        apiKey: string,
        options: StreamChatOptions
    ): Promise<string> {
        const formattedMessages: Array<{ role: string; content: string }> = [];
        if (options.systemPrompt?.trim()) {
            formattedMessages.push({ role: "system", content: options.systemPrompt.trim() });
        }
        for (const msg of options.messages) {
            formattedMessages.push({ role: msg.role, content: msg.content });
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey.trim()}`,
                "HTTP-Referer": "https://foliet.app",
                "X-Title": "Foliet",
            },
            body: JSON.stringify({
                model,
                messages: formattedMessages,
                stream: true,
            }),
            signal: options.signal,
        });

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "OpenRouter"));
        }

        if (!response.body) {
            throw new Error("[OpenRouter] No response body received.");
        }

        let fullText = "";
        await streamLines(response.body.getReader(), options.signal, (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) return;

            const dataStr = trimmed.slice(5).trim();
            if (dataStr === "[DONE]") return;

            try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta) {
                    fullText += delta;
                    options.onChunk(delta);
                }
            } catch {
                // Ignore incomplete SSE frames
            }
        });

        return fullText;
    }

    // =========================================================================
    // OpenAI
    // =========================================================================

    private static async streamOpenAi(
        model: string,
        apiKey: string,
        options: StreamChatOptions
    ): Promise<string> {
        const formattedMessages: Array<{ role: string; content: string }> = [];
        if (options.systemPrompt?.trim()) {
            formattedMessages.push({ role: "system", content: options.systemPrompt.trim() });
        }
        for (const msg of options.messages) {
            formattedMessages.push({ role: msg.role, content: msg.content });
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey.trim()}`,
            },
            body: JSON.stringify({
                model,
                messages: formattedMessages,
                stream: true,
            }),
            signal: options.signal,
        });

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "OpenAI"));
        }

        if (!response.body) {
            throw new Error("[OpenAI] No response body received.");
        }

        let fullText = "";
        await streamLines(response.body.getReader(), options.signal, (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) return;

            const dataStr = trimmed.slice(5).trim();
            if (dataStr === "[DONE]") return;

            try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta) {
                    fullText += delta;
                    options.onChunk(delta);
                }
            } catch {
                // Ignore incomplete SSE frames
            }
        });

        return fullText;
    }

    // =========================================================================
    // Anthropic
    // =========================================================================

    private static async streamAnthropic(
        model: string,
        apiKey: string,
        options: StreamChatOptions
    ): Promise<string> {
        // Anthropic requires roles to be user or assistant only.
        const anthropicMessages = options.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({ role: m.role, content: m.content }));

        const bodyPayload: Record<string, any> = {
            model,
            max_tokens: 4096,
            messages: anthropicMessages,
            stream: true,
        };

        if (options.systemPrompt?.trim()) {
            bodyPayload.system = options.systemPrompt.trim();
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
        await streamLines(response.body.getReader(), options.signal, (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) return;

            const dataStr = trimmed.slice(5).trim();
            try {
                const parsed = JSON.parse(dataStr);
                if (
                    parsed.type === "content_block_delta" &&
                    parsed.delta?.type === "text_delta" &&
                    typeof parsed.delta.text === "string"
                ) {
                    fullText += parsed.delta.text;
                    options.onChunk(parsed.delta.text);
                }
            } catch {
                // Ignore non-JSON lines or keep-alive frames
            }
        });

        return fullText;
    }

    // =========================================================================
    // Google AI Studio (Gemini)
    // =========================================================================

    private static async streamGoogleAiStudio(
        model: string,
        apiKey: string,
        options: StreamChatOptions
    ): Promise<string> {
        const contents = options.messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }],
            }));

        const bodyPayload: Record<string, any> = { contents };

        if (options.systemPrompt?.trim()) {
            bodyPayload.systemInstruction = {
                parts: [{ text: options.systemPrompt.trim() }],
            };
        }

        const cleanModel = model.replace(/^models\//, "");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            cleanModel
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
        await streamLines(response.body.getReader(), options.signal, (line) => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) return;

            const dataStr = trimmed.slice(5).trim();
            try {
                const parsed = JSON.parse(dataStr);
                const candidate = parsed.candidates?.[0];
                const part = candidate?.content?.parts?.[0];
                if (part && typeof part.text === "string") {
                    fullText += part.text;
                    options.onChunk(part.text);
                }
            } catch {
                // Ignore incomplete SSE frames
            }
        });

        return fullText;
    }

    // =========================================================================
    // Ollama (Local)
    // =========================================================================

    private static async streamOllama(
        model: string,
        endpoint: string,
        options: StreamChatOptions
    ): Promise<string> {
        const formattedMessages: Array<{ role: string; content: string }> = [];
        if (options.systemPrompt?.trim()) {
            formattedMessages.push({ role: "system", content: options.systemPrompt.trim() });
        }
        for (const msg of options.messages) {
            formattedMessages.push({ role: msg.role, content: msg.content });
        }

        const baseUrl = endpoint.replace(/\/+$/, "");
        const chatUrl = `${baseUrl}/api/chat`;

        let response: Response;
        try {
            response = await fetch(chatUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model,
                    messages: formattedMessages,
                    stream: true,
                }),
                signal: options.signal,
            });
        } catch (fetchErr: any) {
            if (options.signal?.aborted || fetchErr?.name === "AbortError") {
                throw fetchErr;
            }
            throw new Error(
                `Unable to connect to Ollama at ${baseUrl}. Ensure Ollama is running and accessible.`
            );
        }

        if (!response.ok) {
            throw new Error(await parseErrorResponse(response, "Ollama"));
        }

        if (!response.body) {
            throw new Error("[Ollama] No response body received.");
        }

        let fullText = "";
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
            } catch {
                // Ignore unparseable lines
            }
        });

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
        docTitle?: string
    ): string {
        const formattedPassages = chunks
            .map((chunk, index) => {
                const title = chunk.docTitle || docTitle || "Current Document";
                return `--- PASSAGE ${index + 1} [Source: "${title}", Page ${chunk.pageNumber}] ---\n${chunk.text.trim()}`;
            })
            .join("\n\n");

        return [
            "You are Foliet's scholarly research assistant. Your task is to provide rigorous, accurate, and insightful answers based on the retrieved academic excerpts below.",
            "",
            "GUIDELINES:",
            "1. GROUNDING & FIDELITY: Base your statements directly on the provided passages. Do not extrapolate unsupported claims.",
            "2. CITATIONS: Whenever stating a finding, metric, argument, or fact from a passage, explicitly cite the source page using bracketed format, e.g., [Page X] or [Title, Page X].",
            "3. UNKNOWN / ABSENT INFO: If the provided excerpts do not contain enough information to answer a question definitively, state clearly that the document excerpts do not provide this information rather than guessing.",
            "4. SCHOLARLY TONE: Maintain a concise, academic tone. Avoid marketing hype, conversational fluff, and unnecessary adjectives.",
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
        contentSnippet?: string
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
}

// Standalone function exports for convenience
export const streamChat = LlmService.streamChat.bind(LlmService);
export const buildRagSystemPrompt = LlmService.buildRagSystemPrompt.bind(LlmService);
export const buildSummarizationPrompt = LlmService.buildSummarizationPrompt.bind(LlmService);
