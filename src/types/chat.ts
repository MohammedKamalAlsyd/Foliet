/**
 * Foliet - Chat, LLM & Reasoning Types
 */
import type {
    EmbeddingProvider,
    ModelStatus,
    ModelDownloadProgress,
    RagCatalog,
    DocumentChunk,
    RagSearchResult,
    RagHyperparameters,
} from "./embedding";

export type LlmProvider =
    | "openrouter"
    | "google-ai-studio"
    | "ollama"
    | "openai"
    | "anthropic";

export interface LlmModelPreset {
    id: string;
    label: string;
    provider: LlmProvider;
    contextWindow: number;
    description: string;
    isDefault?: boolean;
}

export type MessageRole = "system" | "user" | "assistant";

export interface CitationReference {
    chunkId: string;
    docId: string;
    docTitle: string;
    pageNumber: number;
    snippet: string;
}

export interface ChatMessage {
    id: string;
    role: MessageRole;
    content: string;
    timestamp: number;
    citations?: CitationReference[];
    isStreaming?: boolean;
}

export interface ChatConversation {
    id: string;
    docId?: string; // Bound to an active paper or global
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: ChatMessage[];
}

/**
 * Global AI state combining conversational LLM and embedding/RAG retrieval.
 */
export interface AiConfigState {
    // LLM Config
    llmProvider: LlmProvider;
    llmModel: string;
    apiKeys: Record<LlmProvider, string>;
    ollamaEndpoint: string;

    // Embedding Config
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    embeddingApiKey: string;

    // Local Model Lifecycle
    localModelStatus: ModelStatus | null;
    downloadProgress: ModelDownloadProgress | null;
    isDownloadingModel: boolean;

    // Indexing & Catalog
    isIndexing: boolean;
    indexingDocId: string | null;
    indexingProgress: number;
    indexingError: string | null;
    catalog: RagCatalog;

    // Chunk Inspection
    isInspectChunksMode: boolean;
    inspectedChunks: DocumentChunk[];
    isLoadingChunks: boolean;

    // RAG Search State
    ragQuery: string;
    ragResults: RagSearchResult[];
    isSearchingRag: boolean;
    searchScope: "current" | "all";
    activeRagHighlight: RagSearchResult | null;

    // Hyperparameters
    hyperparameters: RagHyperparameters;
}