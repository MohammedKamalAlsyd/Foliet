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
            id: "Xenova/gte-small",
            label: "GTE Small (ONNX)",
            dimensions: 384,
            provider: "local-rust",
            description: "Fast, accurate quantized ONNX local embedding model. Recommended default.",
            isDefault: true,
        },
        {
            id: "Xenova/bge-small-en-v1.5",
            label: "BGE Small EN v1.5 (ONNX)",
            dimensions: 384,
            provider: "local-rust",
            description: "High-performance compact ONNX retrieval model with query instruction prefix.",
        },
    ],

    voyage: [
        {
            id: "voyage-4-lite",
            label: "Voyage 4 Lite",
            dimensions: 1024,
            provider: "voyage",
            description:
                "Low-cost, low-latency embeddings for book summarization pipelines, semantic search, and RAG.",
            isDefault: true,
        },
        {
            id: "voyage-4",
            label: "Voyage 4",
            dimensions: 1024,
            provider: "voyage",
            description:
                "Balanced retrieval quality and performance for academic papers and multi-document search.",
        },
        {
            id: "voyage-4-large",
            label: "Voyage 4 Large",
            dimensions: 1024,
            provider: "voyage",
            description:
                "Premium general-purpose and multilingual embeddings for high-precision research retrieval.",
        },
    ],

    openai: [
        {
            id: "text-embedding-3-small",
            label: "Text Embedding 3 Small",
            dimensions: 1536,
            provider: "openai",
            description:
                "Affordable general-purpose embeddings for semantic search and large-scale document indexing.",
            isDefault: true,
        },
        {
            id: "text-embedding-3-large",
            label: "Text Embedding 3 Large",
            dimensions: 3072,
            provider: "openai",
            description:
                "High-quality multilingual embeddings for precise academic retrieval and complex RAG pipelines.",
        },
    ],

    ollama: [
        {
            id: "qwen3-embedding:0.6b",
            label: "Qwen3 Embedding 0.6B",
            dimensions: 1024,
            provider: "ollama",
            description:
                "Excellent lightweight multilingual retrieval model with 32K context and configurable output dimensions.",
            isDefault: true,
        },
        {
            id: "qwen3-embedding:4b",
            label: "Qwen3 Embedding 4B",
            dimensions: 2560,
            provider: "ollama",
            description:
                "Higher-quality multilingual embeddings for academic research and demanding retrieval workloads.",
        },
        {
            id: "bge-m3",
            label: "BGE-M3",
            dimensions: 1024,
            provider: "ollama",
            description:
                "Multilingual retrieval model supporting dense, sparse, and multi-vector retrieval.",
        },
        {
            id: "embeddinggemma",
            label: "EmbeddingGemma",
            dimensions: 768,
            provider: "ollama",
            description:
                "Compact Google embedding model designed for efficient local semantic search.",
        },
    ],
};

export const LLM_PRESETS: Record<LlmProvider, LlmModelPreset[]> = {
    openrouter: [
        {
            id: "deepseek/deepseek-v4.1-flash",
            label: "DeepSeek V4.1 Flash",
            provider: "openrouter",
            contextWindow: 1048576,
            description:
                "Excellent cost-to-performance ratio for book summarization, extraction, and long-context analysis.",
            isDefault: true,
        },
        {
            id: "google/gemini-3.8-flash",
            label: "Gemini 3.8 Flash",
            provider: "openrouter",
            contextWindow: 1048576,
            description:
                "Fast multimodal model for large PDFs, book summarization, and document synthesis.",
        },
        {
            id: "anthropic/claude-haiku-5.5",
            label: "Claude Haiku 5.5",
            provider: "openrouter",
            contextWindow: 1000000,
            description:
                "Fast and economical model for classification, extraction, and summarization.",
        },
        {
            id: "anthropic/claude-sonnet-5.5",
            label: "Claude Sonnet 5.5",
            provider: "openrouter",
            contextWindow: 1000000,
            description:
                "High-quality reasoning and synthesis for complex academic research.",
        },
    ],

    "google-ai-studio": [
        {
            id: "gemini-3.8-flash",
            label: "Gemini 3.8 Flash",
            provider: "google-ai-studio",
            contextWindow: 1048576,
            description:
                "Fast, cost-effective model for book summarization, PDF analysis, and long-context research.",
            isDefault: true,
        },
    ],

    anthropic: [
        {
            id: "claude-haiku-5-5",
            label: "Claude Haiku 5.5",
            provider: "anthropic",
            contextWindow: 1000000,
            description:
                "Fastest economical option for document processing, extraction, and summarization.",
            isDefault: true,
        },
        {
            id: "claude-sonnet-5-5",
            label: "Claude Sonnet 5.5",
            provider: "anthropic",
            contextWindow: 1000000,
            description:
                "Strong analytical reasoning, academic writing, and multi-document synthesis.",
        },
        {
            id: "claude-opus-5-5",
            label: "Claude Opus 5.5",
            provider: "anthropic",
            contextWindow: 1000000,
            description:
                "Premium model for demanding research, complex reasoning, and deep analysis.",
        },
    ],

    openai: [
        {
            id: "gpt-6-luna",
            label: "GPT-6 Luna",
            provider: "openai",
            contextWindow: 1048576,
            description:
                "Fast and economical model for summarization, extraction, and everyday research tasks.",
            isDefault: true,
        },
        {
            id: "gpt-6.1-sol",
            label: "GPT-6.1 Sol",
            provider: "openai",
            contextWindow: 1048576,
            description:
                "Advanced reasoning for academic research, complex synthesis, and analytical tasks.",
        },
        {
            id: "gpt-6-astra",
            label: "GPT-6 Astra",
            provider: "openai",
            contextWindow: 1048576,
            description:
                "Flagship reasoning model for the most demanding research and problem-solving tasks.",
        },
    ],

    ollama: [
        {
            id: "gemma4:12b",
            label: "Gemma 4 (12B)",
            provider: "ollama",
            contextWindow: 262144,
            description:
                "Multimodal local model for document understanding, summarization, and general tasks.",
            isDefault: true,
        },
        {
            id: "gemma4:31b",
            label: "Gemma 4 (31B)",
            provider: "ollama",
            contextWindow: 262144,
            description:
                "More capable local model for advanced reasoning and document synthesis.",
        },
        {
            id: "qwen3.5:9b",
            label: "Qwen 3.5 (9B)",
            provider: "ollama",
            contextWindow: 262144,
            description:
                "Efficient open-weight multimodal model for local reasoning and document processing.",
        },
    ],
};

export const DEFAULT_RAG_HYPERPARAMETERS: RagHyperparameters = {
    chunkSizeLines: 32,
    overlapLines: 6,
    similarityThreshold: 0.65,
    topK: 5,
    maxTokens: 1024,
    vectorDimension: 384, // Matches Xenova/gte-small default
};

export const DEFAULT_AI_SETTINGS: AiSettings & { webSearchEnabled: boolean } = {
    llmProvider: "openrouter",
    llmModel: "deepseek/deepseek-v4.1-flash",
    apiKeys: {},
    ollamaEndpoint: "http://localhost:11434",
    webSearchEnabled: false,
    embeddingProvider: "local-rust",
    embeddingModel: "Xenova/gte-small",
    embeddingApiKey: "",
    hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },
};
