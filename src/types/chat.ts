/**
 * Foliet - Chat, LLM & Reasoning Types
 */
import type { ModelPreset } from "./common";
import type { EmbeddingProvider, RagHyperparameters } from "./embedding";

export type LlmProvider =
    | "openrouter"
    | "google-ai-studio"
    | "ollama"
    | "openai"
    | "anthropic";

export interface LlmModelPreset extends ModelPreset<LlmProvider> {
    contextWindow: number;
}

export type MessageRole = "system" | "user" | "assistant";

export interface CitationReference {
    chunkId: string;
    docId: string;
    docTitle: string;
    pageNumber: number;
    snippet: string;
}

export type ToolCallName =
    | "navigate_to"
    | "highlight_passage"
    | "explain_figure"
    | "add_figure_to_summary";

export interface ExecutedToolCall {
    id: string;
    name: ToolCallName | string;
    arguments: Record<string, any>;
    result: string;
    status: "success" | "error";
    badgeLabel: string;
}

export interface ChatMessage {
    id: string;
    role: MessageRole;
    content: string;
    timestamp: number;
    citations?: CitationReference[];
    toolCalls?: ExecutedToolCall[];
    isStreaming?: boolean;
}

export interface ChatConversation {
    id: string;
    docId?: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
}

/**
 * Persisted AI configuration matching `SettingsStorage`.
 */
export interface AiConfigState {
    // LLM Config
    llmProvider: LlmProvider;
    llmModel: string;
    apiKeys: Record<LlmProvider, string>;
    ollamaEndpoint: string;
    webSearchEnabled: boolean;

    // Embedding Config
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    embeddingApiKey: string;

    // Hyperparameters
    hyperparameters: RagHyperparameters;
}