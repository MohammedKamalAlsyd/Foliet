import type {
    EmbeddingProvider,
    EmbeddingModelPreset,
    RagHyperparameters,
} from "@/types/embedding";
import type { LlmProvider, LlmModelPreset } from "@/types/chat";
import { AiSettings } from "@/services/storage/settings";

export const EMBEDDING_PRESETS: Record<EmbeddingProvider, EmbeddingModelPreset[]> = {
    "local-rust": [
        {
            id: "thenlper/gte-small",
            label: "GTE Small",
            dimensions: 384,
            provider: "local-rust",
            description: "Fast, accurate local embedding model (67MB). Recommended default.",
            isDefault: true,
        },
        {
            id: "Xenova/bge-small-en-v1.5",
            label: "BGE Small EN v1.5",
            dimensions: 384,
            provider: "local-rust",
            description: "High performance compact retrieval model.",
        },
    ],
    voyage: [
        {
            id: "voyage-3-lite",
            label: "Voyage 3 Lite",
            dimensions: 512,
            provider: "voyage",
            description: "Optimized for low latency and cost-effective research retrieval.",
            isDefault: true,
        },
        {
            id: "voyage-3",
            label: "Voyage 3",
            dimensions: 1024,
            provider: "voyage",
            description: "State-of-the-art general embedding model.",
        },
    ],
    openai: [
        {
            id: "text-embedding-3-small",
            label: "Text Embedding 3 Small",
            dimensions: 1536,
            provider: "openai",
            description: "Efficient cloud embeddings with wide utility.",
            isDefault: true,
        },
        {
            id: "text-embedding-3-large",
            label: "Text Embedding 3 Large",
            dimensions: 3072,
            provider: "openai",
            description: "Maximum precision cloud embedding model.",
        },
    ],
    ollama: [
        {
            id: "nomic-embed-text",
            label: "Nomic Embed Text",
            dimensions: 768,
            provider: "ollama",
            description: "Popular open embedding model hosted locally via Ollama.",
            isDefault: true,
        },
        {
            id: "mxbai-embed-large",
            label: "mxbai-embed-large",
            dimensions: 1024,
            provider: "ollama",
            description: "High quality 1024-dimension local retrieval model.",
        },
    ],
};

export const LLM_PRESETS: Record<LlmProvider, LlmModelPreset[]> = {
    openrouter: [
        {
            id: "anthropic/claude-3.5-sonnet",
            label: "Claude 3.5 Sonnet",
            provider: "openrouter",
            contextWindow: 200000,
            description: "Leading model for academic reasoning, synthesis, and PDF analysis.",
            isDefault: true,
        },
        {
            id: "meta-llama/llama-3.3-70b-instruct",
            label: "Llama 3.3 70B",
            provider: "openrouter",
            contextWindow: 128000,
            description: "Open-weights model with strong research comprehension.",
        },
    ],
    "google-ai-studio": [
        {
            id: "gemini-1.5-pro",
            label: "Gemini 1.5 Pro",
            provider: "google-ai-studio",
            contextWindow: 2000000,
            description: "Ultra-long context window suited for whole-book research.",
            isDefault: true,
        },
        {
            id: "gemini-1.5-flash",
            label: "Gemini 1.5 Flash",
            provider: "google-ai-studio",
            contextWindow: 1000000,
            description: "Fast responses with 1M context capacity.",
        },
    ],
    anthropic: [
        {
            id: "claude-3-5-sonnet-latest",
            label: "Claude 3.5 Sonnet",
            provider: "anthropic",
            contextWindow: 200000,
            description: "High accuracy and scholarly analysis.",
            isDefault: true,
        },
        {
            id: "claude-3-5-haiku-latest",
            label: "Claude 3.5 Haiku",
            provider: "anthropic",
            contextWindow: 200000,
            description: "Rapid latency for quick queries and definitions.",
        },
    ],
    openai: [
        {
            id: "gpt-4o",
            label: "GPT-4o",
            provider: "openai",
            contextWindow: 128000,
            description: "Omni model for fast analysis and structured reasoning.",
            isDefault: true,
        },
        {
            id: "gpt-4o-mini",
            label: "GPT-4o Mini",
            provider: "openai",
            contextWindow: 128000,
            description: "Lightweight, low-latency queries.",
        },
    ],
    ollama: [
        {
            id: "llama3.2:latest",
            label: "Llama 3.2 (3B)",
            provider: "ollama",
            contextWindow: 128000,
            description: "Local model for quick summarization on modest hardware.",
            isDefault: true,
        },
        {
            id: "qwen2.5:7b",
            label: "Qwen 2.5 (7B)",
            provider: "ollama",
            contextWindow: 32000,
            description: "Strong local reasoning for academic papers.",
        },
    ],
};

export const DEFAULT_RAG_HYPERPARAMETERS: RagHyperparameters = {
    chunkSizeLines: 32,
    overlapLines: 6,
    similarityThreshold: 0.65,
    topK: 5,
    maxTokens: 1024,
    vectorDimension: 384, // Matches GTE Small default
};


export const DEFAULT_AI_SETTINGS: AiSettings = {
    llmProvider: "openrouter",
    llmModel: "anthropic/claude-3.5-sonnet",
    apiKeys: {},
    ollamaEndpoint: "http://localhost:11434",
    embeddingProvider: "local-rust",
    embeddingModel: "thenlper/gte-small",
    embeddingApiKey: "",
    hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },
};