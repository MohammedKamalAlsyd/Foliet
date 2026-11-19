/**
 * Foliet - Embedding & RAG Vector Retrieval Types
 */
import type { DocRef, ModelPreset, Rect } from "./common";

export type EmbeddingProvider = "local-rust" | "voyage" | "openai" | "ollama";

export interface EmbeddingConfig {
    provider: EmbeddingProvider;
    model: string;
    apiKey?: string;
    endpoint?: string;
}

export interface EmbeddingModelPreset extends ModelPreset<EmbeddingProvider> {
    dimensions: number;
}

interface ChunkBase {
    chunkId: string;
    pageNumber: number;
    text: string;
    rectSegments?: Rect[];
}

export interface DocumentChunk extends ChunkBase {
    chunkIndex: number;
    embedding?: number[];
}

export type HighlightKind = "rag" | "citation" | "tool";

export interface RagSearchResult extends ChunkBase {
    docId: string;
    docTitle: string;
    similarityScore: number;
    highlightKind?: HighlightKind;
}

export interface CatalogEntry extends DocRef {
    chunkCount: number;
    embeddingModel: string;
    provider: EmbeddingProvider;
    indexedAt: string;
}

export interface IndexingScope extends DocRef {
    selectedPageRanges?: [number, number][];
}

export interface RagCatalog {
    documents: CatalogEntry[];
}

export interface RagHyperparameters {
    chunkSizeLines: number;
    overlapLines: number;
    similarityThreshold: number;
    topK: number;
    maxTokens: number;
    vectorDimension: number;
}

export interface RagIndexProgress {
    docId: string;
    stage: "extracting" | "chunking" | "embedding" | "saving";
    currentPage: number;
    totalPages: number;
    processedChunks: number;
    totalChunks: number;
    percent: number;
}

export interface ModelDownloadProgress {
    modelId: string;
    percent: number;
    downloadedBytes: number;
    totalBytes: number;
    isComplete: boolean;
    error?: string | null;
}

interface ModelFileBase {
    modelId: string;
    fileSizeMb: number;
}

export interface ModelStatus extends ModelFileBase {
    isAvailable: boolean;
    isDownloading: boolean;
    provider: EmbeddingProvider;
}

export interface DownloadedModelInfo extends ModelFileBase {
    dirName: string;
}

export interface RagSearchQuery {
    query: string;
    topK?: number;
    targetDocId?: string | null;
    similarityThreshold?: number;
}

export interface RagState {
    // Model lifecycle
    localModelStatus: ModelStatus | null;
    downloadProgress: ModelDownloadProgress | null;
    isDownloadingModel: boolean;
    downloadedModels: DownloadedModelInfo[];
    isDeletingModel: boolean;
    // Indexing
    isIndexing: boolean;
    indexingDocId: string | null;
    indexingProgress: number;
    indexingProgressDetail: RagIndexProgress | null;
    indexingError: string | null;
    catalog: RagCatalog;
    // Chunk inspection
    inspectedChunks: DocumentChunk[];
    isLoadingChunks: boolean;
    // Search
    ragQuery: string;
    ragResults: RagSearchResult[];
    isSearchingRag: boolean;
    searchScope: "current" | "all";
    activeRagHighlight: RagSearchResult | null;
}