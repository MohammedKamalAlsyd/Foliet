import { vi } from "vitest";
import type {
  DocumentChunk,
  DownloadedModelInfo,
  EmbeddingConfig,
  IndexingScope,
  ModelDownloadProgress,
  ModelStatus,
  RagCatalog,
  RagHyperparameters,
  RagIndexProgress,
  RagSearchQuery,
  RagSearchResult,
} from "@/types/embedding";

export interface MockCloseRequestedEvent {
  preventDefault: ReturnType<typeof vi.fn>;
  isDefaultPrevented: () => boolean;
}

type CloseHandler = (event: MockCloseRequestedEvent) => void;
type TauriEventHandler = (event: { payload: unknown }) => void;

export const mockDialogSave = vi.fn<
  (options?: unknown) => Promise<string | null>
>(async () => "/mock/exports/output.md");

export const mockDialogOpen = vi.fn<
  (options?: unknown) => Promise<string | string[] | null>
>(async () => null);

export const writtenFiles = new Map<string, Uint8Array>();

export const mockFsWriteFile = vi.fn<
  (path: string, data: Uint8Array) => Promise<void>
>(async (filePath, data) => {
  writtenFiles.set(filePath, new Uint8Array(data));
});

export const mockOpenUrl = vi.fn<(url: string) => Promise<void>>(async () => {});
export const mockRevealItemInDir = vi.fn<(path: string) => Promise<void>>(
  async () => {},
);

export const mockUpdaterCheck = vi.fn<(...args: unknown[]) => Promise<any>>(
  async () => null,
);
export const mockProcessRelaunch = vi.fn<() => Promise<void>>(async () => {});

export interface MockSecretsBackendState {
  apiKeys: Record<string, string>;
  embeddingApiKey: string;
}

export let mockSecretsBackend: MockSecretsBackendState = {
  apiKeys: {},
  embeddingApiKey: "",
};

const closeRequestedListeners = new Set<CloseHandler>();
const maximizeListeners = new Set<(isMax: boolean) => void>();

export const mockWindowClose = vi.fn<() => Promise<void>>(async () => {});
export const mockWindowMinimize = vi.fn<() => Promise<void>>(async () => {});
export const mockWindowToggleMaximize = vi.fn<() => Promise<boolean>>(
  async () => false,
);
export const mockWindowIsMaximized = vi.fn<() => Promise<boolean>>(
  async () => false,
);

export const MockWindowService = {
  minimize: () => mockWindowMinimize(),
  toggleMaximize: () => mockWindowToggleMaximize(),
  isMaximized: () => mockWindowIsMaximized(),
  close: () => mockWindowClose(),
  onCloseRequested: vi.fn(async (callback: CloseHandler) => {
    closeRequestedListeners.add(callback);
    return () => {
      closeRequestedListeners.delete(callback);
    };
  }),
  onMaximizeChange: vi.fn(async (callback: (isMax: boolean) => void) => {
    maximizeListeners.add(callback);
    return () => {
      maximizeListeners.delete(callback);
    };
  }),
};

/**
 * Triggers an OS-level window close request event through all registered
 * `WindowService.onCloseRequested` callbacks (mimicking Tauri's close hook).
 */
export function triggerCloseRequested(): {
  event: MockCloseRequestedEvent;
  prevented: boolean;
} {
  let prevented = false;
  const event: MockCloseRequestedEvent = {
    preventDefault: vi.fn(() => {
      prevented = true;
    }),
    isDefaultPrevented: () => prevented,
  };
  for (const listener of Array.from(closeRequestedListeners)) {
    listener(event);
  }
  return { event, prevented };
}

// ============================================================================
// Tauri Event Bus & IPC Command Fakes (powers real RagService & PdfService)
// ============================================================================

const tauriEventListeners = new Map<string, Set<TauriEventHandler>>();

export const mockTauriListen = vi.fn(
  async (eventName: string, handler: TauriEventHandler) => {
    let set = tauriEventListeners.get(eventName);
    if (!set) {
      set = new Set();
      tauriEventListeners.set(eventName, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  },
);

export function emitTauriEvent(eventName: string, payload: unknown): void {
  const listeners = tauriEventListeners.get(eventName);
  if (!listeners) return;
  for (const fn of Array.from(listeners)) {
    fn({ payload });
  }
}

export function emitRagIndexProgress(progress: RagIndexProgress): void {
  emitTauriEvent("rag_index_progress", progress);
}

export function emitModelDownloadProgress(
  progress: ModelDownloadProgress,
): void {
  emitTauriEvent("rag_model_download_progress", progress);
}

export interface MockRagBackendState {
  catalog: RagCatalog;
  chunksByDoc: Map<string, DocumentChunk[]>;
  modelStatus: ModelStatus;
  downloadedModels: DownloadedModelInfo[];
  searchHandler: (
    query: RagSearchQuery,
    embeddingConfig: EmbeddingConfig,
  ) => Promise<RagSearchResult[]> | RagSearchResult[];
  indexHandler: (
    scope: IndexingScope,
    config: RagHyperparameters,
    embeddingConfig: EmbeddingConfig,
  ) => Promise<{ chunkCount: number }> | { chunkCount: number };
}

function createDefaultRagBackend(): MockRagBackendState {
  return {
    catalog: { documents: [] },
    chunksByDoc: new Map(),
    modelStatus: {
      provider: "local-rust",
      modelId: "Xenova/all-MiniLM-L6-v2",
      isAvailable: true,
      isDownloading: false,
      fileSizeMb: 23,
    },
    downloadedModels: [
      {
        modelId: "Xenova/all-MiniLM-L6-v2",
        dirName: "Xenova--all-MiniLM-L6-v2",
        fileSizeMb: 23,
      },
    ],
    searchHandler: (query) => {
      const results: RagSearchResult[] = [];
      for (const [docId, chunks] of mockRagBackend.chunksByDoc.entries()) {
        if (query.targetDocId && docId !== query.targetDocId) continue;
        const catDoc = mockRagBackend.catalog.documents.find(
          (d) => d.docId === docId,
        );
        for (const chunk of chunks) {
          if (
            chunk.text.toLowerCase().includes(query.query.toLowerCase()) ||
            query.query.trim().length > 0
          ) {
            results.push({
              chunkId: chunk.chunkId,
              docId,
              docTitle: catDoc?.docTitle ?? "Document",
              pageNumber: chunk.pageNumber,
              text: chunk.text,
              similarityScore: 0.88,
              rectSegments: chunk.rectSegments,
            });
          }
        }
      }
      const threshold = query.similarityThreshold ?? 0;
      const topK = query.topK ?? 5;
      return results
        .filter((r) => r.similarityScore >= threshold)
        .slice(0, topK);
    },
    indexHandler: (scope) => {
      const existing = mockRagBackend.chunksByDoc.get(scope.docId) ?? [];
      const count = existing.length || 2;
      const entry = {
        docId: scope.docId,
        docTitle: scope.docTitle,
        filePath: scope.filePath,
        chunkCount: count,
        indexedAt: new Date().toISOString(),
        embeddingModel: "Xenova/all-MiniLM-L6-v2",
        provider: "local-rust" as const,
      };
      mockRagBackend.catalog = {
        documents: [
          ...mockRagBackend.catalog.documents.filter(
            (d) => d.docId !== scope.docId,
          ),
          entry,
        ],
      };
      return { chunkCount: count };
    },
  };
}

export let mockRagBackend: MockRagBackendState = createDefaultRagBackend();

export const mockTauriInvoke = vi.fn(
  async (cmd: string, args: Record<string, any> = {}): Promise<any> => {
    switch (cmd) {
      case "rag_get_model_status":
        return {
          ...mockRagBackend.modelStatus,
          provider: args.provider ?? mockRagBackend.modelStatus.provider,
          modelId: args.modelId ?? mockRagBackend.modelStatus.modelId,
        };
      case "rag_list_downloaded_models":
        return [...mockRagBackend.downloadedModels];
      case "rag_download_model":
        mockRagBackend.modelStatus = {
          ...mockRagBackend.modelStatus,
          modelId: args.modelId ?? mockRagBackend.modelStatus.modelId,
          isAvailable: true,
          fileSizeMb: 23,
        };
        return undefined;
      case "rag_delete_model":
        mockRagBackend.downloadedModels =
          mockRagBackend.downloadedModels.filter(
            (m) => m.modelId !== args.modelId,
          );
        mockRagBackend.modelStatus = {
          ...mockRagBackend.modelStatus,
          isAvailable: false,
          fileSizeMb: 0,
        };
        return undefined;
      case "rag_get_catalog":
        return structuredClone(mockRagBackend.catalog);
      case "rag_get_document_chunks":
        return structuredClone(
          mockRagBackend.chunksByDoc.get(args.docId) ?? [],
        );
      case "rag_index_document":
        return await mockRagBackend.indexHandler(
          args.scope,
          args.config,
          args.embeddingConfig,
        );
      case "rag_remove_document_index":
        mockRagBackend.chunksByDoc.delete(args.docId);
        mockRagBackend.catalog = {
          documents: mockRagBackend.catalog.documents.filter(
            (d) => d.docId !== args.docId,
          ),
        };
        return undefined;
      case "rag_search":
        return await mockRagBackend.searchHandler(
          args.query,
          args.embeddingConfig,
        );
      case "get_launch_pdf_path":
        return null;
      case "export_pdf":
        return undefined;
      case "extract_pdf_annotations":
        return [];
      case "open_pdf_document":
        return {
          id: "doc-opened",
          title: "Opened PDF",
          fileName: "opened.pdf",
          filePath: args.filePath ?? "/mock/opened.pdf",
          fileSize: 2048,
          extractedAnnotations: [],
        };
      case "load_api_secrets":
        return {
          apiKeys: { ...mockSecretsBackend.apiKeys },
          embeddingApiKey: mockSecretsBackend.embeddingApiKey,
        };
      case "save_api_secret": {
        const slot = String(args.slot ?? "").trim();
        const value = String(args.value ?? "");
        if (slot === "embedding" || slot === "embeddingApiKey") {
          mockSecretsBackend.embeddingApiKey = value.trim() ? value : "";
        } else if (slot) {
          if (value.trim()) {
            mockSecretsBackend.apiKeys[slot] = value;
          } else {
            delete mockSecretsBackend.apiKeys[slot];
          }
        }
        return undefined;
      }
      case "delete_api_secret": {
        const slot = String(args.slot ?? "").trim();
        if (slot === "embedding" || slot === "embeddingApiKey") {
          mockSecretsBackend.embeddingApiKey = "";
        } else if (slot) {
          delete mockSecretsBackend.apiKeys[slot];
        }
        return undefined;
      }
      default:
        return undefined;
    }
  },
);

export const mockConvertFileSrc = vi.fn(
  (filePath: string, protocol = "asset") => `${protocol}://localhost/${filePath}`,
);

// In-memory store backing `@tauri-apps/plugin-store`
export const mockTauriStoreMap = new Map<string, Map<string, unknown>>();

export class MockLazyStore {
  private readonly storeName: string;

  constructor(storeName: string) {
    this.storeName = storeName;
  }

  private get bucket(): Map<string, unknown> {
    let b = mockTauriStoreMap.get(this.storeName);
    if (!b) {
      b = new Map();
      mockTauriStoreMap.set(this.storeName, b);
    }
    return b;
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.bucket.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.bucket.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<boolean> {
    return this.bucket.delete(key);
  }

  async save(): Promise<void> {}
}

export function resetMockTauri(): void {
  writtenFiles.clear();
  closeRequestedListeners.clear();
  maximizeListeners.clear();
  tauriEventListeners.clear();
  mockTauriStoreMap.clear();
  mockRagBackend = createDefaultRagBackend();
  mockSecretsBackend = { apiKeys: {}, embeddingApiKey: "" };

  mockDialogSave.mockReset().mockResolvedValue("/mock/exports/output.md");
  mockDialogOpen.mockReset().mockResolvedValue(null);
  mockFsWriteFile.mockReset().mockImplementation(async (filePath, data) => {
    writtenFiles.set(filePath, new Uint8Array(data));
  });
  mockOpenUrl.mockReset().mockResolvedValue(undefined);
  mockRevealItemInDir.mockReset().mockResolvedValue(undefined);
  mockUpdaterCheck.mockReset().mockResolvedValue(null);
  mockProcessRelaunch.mockReset().mockResolvedValue(undefined);
  mockWindowClose.mockReset().mockResolvedValue(undefined);
  mockWindowMinimize.mockReset().mockResolvedValue(undefined);
  mockWindowToggleMaximize.mockReset().mockResolvedValue(false);
  mockWindowIsMaximized.mockReset().mockResolvedValue(false);
  MockWindowService.onCloseRequested.mockClear();
  MockWindowService.onMaximizeChange.mockClear();
  mockTauriListen.mockClear();
  mockTauriInvoke.mockClear();
  mockConvertFileSrc.mockClear();
}
