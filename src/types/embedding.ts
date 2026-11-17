/**
 * Foliet - Embedding & RAG Vector Retrieval Types
 */

export type EmbeddingProvider =
    | "local-rust"
    | "voyage"
    | "openai"
    | "ollama";

export interface RectSegment {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface EmbeddingConfig {
    provider: EmbeddingProvider;
    model: string;
    apiKey?: string;
    endpoint?: string;
}

export interface EmbeddingModelPreset {
    id: string;
    label: string;
    dimensions: number;
    provider: EmbeddingProvider;
    description: string;
    isDefault?: boolean;
}

export interface DocumentChunk {
    chunkId: string;
    pageNumber: number;
    chunkIndex: number;
    text: string;
    embedding?: number[];
    rectSegments?: RectSegment[];
}

export interface CatalogEntry {
    docId: string;
    docTitle: string;
    filePath: string;
    chunkCount: number;
    embeddingModel: string;
    provider: EmbeddingProvider;
    indexedAt: string;
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

export interface ModelStatus {
    modelId: string;
    isAvailable: boolean;
    isDownloading: boolean;
    fileSizeMb: number;
    provider: EmbeddingProvider;
}

export interface DownloadedModelInfo {
    modelId: string;
    fileSizeMb: number;
    dirName: string;
}

export interface IndexingScope {
    docId: string;
    docTitle: string;
    filePath: string;
    selectedPageRanges?: [number, number][];
}

export interface RagSearchQuery {
    query: string;
    topK?: number;
    targetDocId?: string | null;
    similarityThreshold?: number;
}

export interface RagSearchResult {
    chunkId: string;
    docId: string;
    docTitle: string;
    pageNumber: number;
    text: string;
    similarityScore: number;
    rectSegments?: RectSegment[];
}

/**
 * Transient RAG runtime & UI state interfaces.
 */
export interface RagModelLifecycleState {
    localModelStatus: ModelStatus | null;
    downloadProgress: ModelDownloadProgress | null;
    isDownloadingModel: boolean;
    downloadedModels: DownloadedModelInfo[];
    isDeletingModel: boolean;
}

export interface RagIndexingState {
    isIndexing: boolean;
    indexingDocId: string | null;
    indexingProgress: number;
    indexingProgressDetail: RagIndexProgress | null;
    indexingError: string | null;
    catalog: RagCatalog;
}

export interface RagChunkInspectionState {
    isInspectChunksMode: boolean;
    inspectedChunks: DocumentChunk[];
    isLoadingChunks: boolean;
}

export interface RagSearchState {
    ragQuery: string;
    ragResults: RagSearchResult[];
    isSearchingRag: boolean;
    searchScope: "current" | "all";
    activeRagHighlight: RagSearchResult | null;
}

export interface RagState
    extends RagModelLifecycleState,
    RagIndexingState,
    RagChunkInspectionState,
    RagSearchState { }