/**
 * Foliet - Typed RAG IPC Service
 *
 * Provides a strongly-typed IPC interface to the Tauri / Rust embedding
 * and dense retrieval backend, mirroring the architecture of `src/services/pdf.ts`.
 *
 * Includes a `USE_MOCK_RAG = true` development toggle (with automatic fallback
 * when Rust backend commands are not yet registered), returning realistic
 * academic excerpts, catalog entries, and vector search results.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
    EmbeddingProvider,
    ModelStatus,
    ModelDownloadProgress,
    IndexingScope,
    RagHyperparameters,
    RagCatalog,
    DocumentChunk,
    RagSearchQuery,
    RagSearchResult,
    CatalogEntry,
} from "@/types/embedding";

export let USE_MOCK_RAG = true;

export function setUseMockRag(value: boolean): void {
    USE_MOCK_RAG = value;
}

// =============================================================================
// Realistic Mock In-Memory RAG Store
// =============================================================================

const mockDownloadListeners = new Set<(progress: ModelDownloadProgress) => void>();

const mockCatalog: RagCatalog = {
    documents: [
        {
            docId: "doc-sample-attention",
            docTitle: "Attention Is All You Need",
            filePath: "/papers/attention-is-all-you-need.pdf",
            chunkCount: 6,
            embeddingModel: "thenlper/gte-small",
            provider: "local-rust",
            indexedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        },
    ],
};

function createDefaultChunks(docId: string, _docTitle = "Research Document"): DocumentChunk[] {
    return [
        {
            chunkId: `${docId}-chunk-1`,
            pageNumber: 1,
            chunkIndex: 0,
            text: `Abstract: We propose the Transformer, a novel neural architecture based solely on self-attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less training time. On the WMT 2014 English-to-German translation task, our model establishes a new state of the art.`,
        },
        {
            chunkId: `${docId}-chunk-2`,
            pageNumber: 2,
            chunkIndex: 1,
            text: `1. Introduction: Recurrent neural networks, long short-term memory (LSTM), and gated recurrent neural networks have been firmly established as state-of-the-art approaches in sequence modeling and transduction problems. Sequential computation inherently precludes parallelization within training examples, which becomes critical at longer sequence lengths, as memory constraints limit batching across examples.`,
        },
        {
            chunkId: `${docId}-chunk-3`,
            pageNumber: 3,
            chunkIndex: 2,
            text: `3. Model Architecture: Most competitive neural sequence transduction models have an encoder-decoder structure. The encoder maps an input sequence of symbol representations (x_1, ..., x_n) to a sequence of continuous representations z = (z_1, ..., z_n). Given z, the decoder then generates an output sequence (y_1, ..., y_m) of symbols one element at a time. The Transformer follows this overall architecture using stacked self-attention and point-wise, fully connected layers.`,
        },
        {
            chunkId: `${docId}-chunk-4`,
            pageNumber: 4,
            chunkIndex: 3,
            text: `3.2 Attention: An attention function can be described as mapping a query and a set of key-value pairs to an output, where the query, keys, values, and output are all vectors. The output is computed as a weighted sum of the values, where the weight assigned to each value is computed by a compatibility function of the query with the corresponding key. Specifically, Scaled Dot-Product Attention is computed as Attention(Q, K, V) = softmax(Q K^T / sqrt(d_k)) V.`,
        },
        {
            chunkId: `${docId}-chunk-5`,
            pageNumber: 7,
            chunkIndex: 4,
            text: `5. Training & Regularization: We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs. Sentences were encoded using byte-pair encoding. We used the Adam optimizer with beta_1 = 0.9, beta_2 = 0.98 and epsilon = 1e-9. We increased learning rate linearly for the first 4000 warmup steps, decreasing thereafter proportionally to the inverse square root of the step number.`,
        },
        {
            chunkId: `${docId}-chunk-6`,
            pageNumber: 9,
            chunkIndex: 5,
            text: `6. Results & Benchmark Comparisons: On the WMT 2014 English-to-German translation task, the big transformer model outperforms the best previously reported models (including ensembles) by more than 2.0 BLEU, establishing a new state-of-the-art BLEU score of 28.4. On the English-to-French task, our model achieves a BLEU score of 41.8, outperforming all previously published single models at a fraction of the training cost.`,
        },
    ];
}

const mockChunksStore = new Map<string, DocumentChunk[]>([
    ["doc-sample-attention", createDefaultChunks("doc-sample-attention", "Attention Is All You Need")],
]);

// Helper to determine if an error was due to an unregistered Tauri IPC command
function isCommandNotFoundError(err: any): boolean {
    const message = typeof err === "string" ? err : err?.message || "";
    return (
        message.includes("command") &&
        (message.includes("not found") || message.includes("not registered")) ||
        message.includes("is not implemented") ||
        message.includes("__TAURI_INTERNALS__")
    );
}

export class RagService {
    /**
     * Checks availability and download status for the specified embedding model.
     */
    public static async getModelStatus(
        provider: EmbeddingProvider,
        modelId: string
    ): Promise<ModelStatus> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<ModelStatus>("rag_get_model_status", {
                    provider,
                    modelId,
                });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Rust IPC command 'rag_get_model_status' not registered. Falling back to mock.");
            }
        }

        // Mock status
        return {
            modelId,
            isAvailable: true,
            isDownloading: false,
            fileSizeMb: provider === "local-rust" ? 67 : 0,
            provider,
        };
    }

    /**
     * Downloads a local embedding model file into the application data directory.
     */
    public static async downloadModel(modelId: string): Promise<void> {
        if (!USE_MOCK_RAG) {
            try {
                await invoke("rag_download_model", { modelId });
                return;
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Rust IPC command 'rag_download_model' not registered. Falling back to mock.");
            }
        }

        // Mock progress simulation
        const emitProgress = (percent: number, isComplete = false) => {
            const total = 67 * 1024 * 1024;
            const downloaded = Math.round((percent / 100) * total);
            mockDownloadListeners.forEach((listener) => {
                listener({
                    modelId,
                    percent,
                    downloadedBytes: downloaded,
                    totalBytes: total,
                    isComplete,
                });
            });
        };

        emitProgress(25);
        await new Promise((r) => setTimeout(r, 200));
        emitProgress(60);
        await new Promise((r) => setTimeout(r, 200));
        emitProgress(100, true);
    }

    /**
     * Listens for local embedding model download progress events.
     */
    public static async onModelDownloadProgress(
        callback: (progress: ModelDownloadProgress) => void
    ): Promise<UnlistenFn> {
        mockDownloadListeners.add(callback);

        let tauriUnlisten: UnlistenFn | null = null;
        try {
            tauriUnlisten = await listen<ModelDownloadProgress>(
                "rag_model_download_progress",
                (event) => callback(event.payload)
            );
        } catch {
            // Tauri event listener not available in mock/browser mode
        }

        return () => {
            mockDownloadListeners.delete(callback);
            tauriUnlisten?.();
        };
    }

    /**
     * Indexes a document into the vector index using the provided scope and RAG hyperparameters.
     */
    public static async indexDocument(
        scope: IndexingScope,
        config: RagHyperparameters
    ): Promise<{ chunkCount: number }> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<{ chunkCount: number }>("rag_index_document", {
                    scope,
                    config,
                });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Rust IPC command 'rag_index_document' not registered. Falling back to mock.");
            }
        }

        // Mock index creation
        const existing = mockChunksStore.get(scope.docId);
        const chunks = existing || createDefaultChunks(scope.docId, scope.docTitle);
        mockChunksStore.set(scope.docId, chunks);

        // Update catalog
        const filteredDocs = mockCatalog.documents.filter((d) => d.docId !== scope.docId);
        filteredDocs.push({
            docId: scope.docId,
            docTitle: scope.docTitle,
            filePath: scope.filePath,
            chunkCount: chunks.length,
            embeddingModel: "thenlper/gte-small",
            provider: "local-rust",
            indexedAt: new Date().toISOString(),
        });
        mockCatalog.documents = filteredDocs;

        return { chunkCount: chunks.length };
    }

    /**
     * Removes a document's vector index and associated embeddings.
     */
    public static async removeDocumentIndex(docId: string): Promise<void> {
        if (!USE_MOCK_RAG) {
            try {
                await invoke("rag_remove_document_index", { docId });
                return;
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Rust IPC command 'rag_remove_document_index' not registered. Falling back to mock.");
            }
        }

        // Mock removal
        mockChunksStore.delete(docId);
        mockCatalog.documents = mockCatalog.documents.filter((d) => d.docId !== docId);
    }

    /**
     * Retrieves the persistent RAG catalog of indexed documents.
     */
    public static async getRagCatalog(): Promise<RagCatalog> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<RagCatalog>("rag_get_catalog");
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Rust IPC command 'rag_get_catalog' not registered. Falling back to mock.");
            }
        }

        return {
            documents: [...mockCatalog.documents],
        };
    }

    /**
     * Retrieves all chunks for a specific document to inspect embeddings or chunking splits.
     */
    public static async getDocumentChunks(docId: string): Promise<DocumentChunk[]> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<DocumentChunk[]>("rag_get_document_chunks", { docId });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Rust IPC command 'rag_get_document_chunks' not registered. Falling back to mock.");
            }
        }

        if (mockChunksStore.has(docId)) {
            return mockChunksStore.get(docId) ?? [];
        }

        const generated = createDefaultChunks(docId);
        mockChunksStore.set(docId, generated);
        return generated;
    }

    /**
     * Performs dense semantic search against the vector index.
     */
    public static async searchRag(query: RagSearchQuery): Promise<RagSearchResult[]> {
        if (!USE_MOCK_RAG) {
            try {
                return await invoke<RagSearchResult[]>("rag_search", { query });
            } catch (err) {
                if (!isCommandNotFoundError(err)) throw err;
                console.warn("RagService: Rust IPC command 'rag_search' not registered. Falling back to mock.");
            }
        }

        const cleanQuery = query.query.toLowerCase().trim();
        const keywords = cleanQuery.split(/\s+/).filter((k) => k.length > 2);
        const topK = query.topK ?? 5;
        const threshold = query.similarityThreshold ?? 0.5;

        // Gather candidate chunks
        let candidateDocs: CatalogEntry[] = [...mockCatalog.documents];
        if (query.targetDocId) {
            candidateDocs = candidateDocs.filter((d) => d.docId === query.targetDocId);
            if (candidateDocs.length === 0) {
                candidateDocs = [
                    {
                        docId: query.targetDocId,
                        docTitle: "Current Document",
                        filePath: "",
                        chunkCount: 6,
                        embeddingModel: "thenlper/gte-small",
                        provider: "local-rust",
                        indexedAt: new Date().toISOString(),
                    },
                ];
            }
        }

        const results: RagSearchResult[] = [];

        for (const doc of candidateDocs) {
            const chunks = mockChunksStore.get(doc.docId) ?? createDefaultChunks(doc.docId, doc.docTitle);
            for (const chunk of chunks) {
                const lowerText = chunk.text.toLowerCase();
                let matches = 0;
                for (const kw of keywords) {
                    if (lowerText.includes(kw)) matches++;
                }

                // Base similarity score: calculated from keyword density or baseline relevance
                const keywordBoost = keywords.length > 0 ? (matches / keywords.length) * 0.35 : 0;
                const score = Math.min(0.96, Math.max(0.68, 0.72 + keywordBoost));

                if (score >= threshold) {
                    results.push({
                        chunkId: chunk.chunkId,
                        docId: doc.docId,
                        docTitle: doc.docTitle,
                        pageNumber: chunk.pageNumber,
                        text: chunk.text,
                        similarityScore: Number(score.toFixed(3)),
                    });
                }
            }
        }

        // Sort by similarity descending and cap at topK
        results.sort((a, b) => b.similarityScore - a.similarityScore);
        return results.slice(0, topK);
    }
}
