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

    /**
     * Constructs a personalized, source-anchored summarization prompt built around
     * the user's selected highlights, underlines, personal notes, figure crops, and chat insights.
     */
    public static buildStructuredSummarizationPrompt(
        input: StructuredSummaryInput
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
                            `${idx + 1}. [Page ${h.pageNumber} · ${h.toolType}] "${h.text.trim()}"`
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
                            }`
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
                                .join("\n")}`
                    )
                    .join("\n\n")
                : "(No Lio chat takeaways selected.)";

        return [
            `You are Foliet's scholarly research assistant synthesizing personal research notes for "${input.docTitle}".`,
            "",
            focusInstructions[input.focusMode],
            "",
            "STRICT SYNTHESIS RULES:",
            "- ANCHOR ON USER MARKUPS: Center the entire document around the user's selected highlights, underlines, and personal sticky notes below. Synthesize, connect, and contextualize what the user marked rather than producing generic filler.",
            "- PAGE CITATIONS: Cite page numbers inline consistently, e.g., `(Page 4)`.",
            "- INTEGRATE CHAT INSIGHTS: Incorporate relevant answers or clarifications from the selected Lio Chat Takeaways naturally into the synthesis.",
            "- FENCED CODE BLOCKS: Whenever explaining an algorithm, formula, protocol, pseudocode, or code structure, ALWAYS wrap it in a clean fenced code block with an explicit language tag (e.g., ```python, ```typescript, ```rust, ```latex, ```text).",
            input.crops.length > 0
                ? "- FIGURE CROPS (IMAGES): Embed the user's captured figure crops directly in the relevant sections on their own line using standard Markdown image syntax with the exact URI provided below, e.g., `![Concise figure description (Page X)](idb://crop-...)`. Never invent, modify, or shorten an image URI, and only reference URIs listed in USER FIGURE CROPS."
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
export const buildRagSystemPrompt = LlmService.buildRagSystemPrompt.bind(LlmService);
export const buildSummarizationPrompt = LlmService.buildSummarizationPrompt.bind(LlmService);
export const buildStructuredSummarizationPrompt =
    LlmService.buildStructuredSummarizationPrompt.bind(LlmService);