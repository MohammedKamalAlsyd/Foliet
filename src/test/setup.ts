import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import {
  MockDocumentDatabase,
  SAMPLE_PNG_DATA_URL,
  mockDatabase,
} from "@/test/fakes/mockDatabase";
import { mockLlm } from "@/test/fakes/mockLlm";
import {
  mockReactPdfModule,
  resetMockPdfViewer,
} from "@/test/fakes/mockPdfViewer";
import {
  MockLazyStore,
  MockWindowService,
  mockConvertFileSrc,
  mockDialogOpen,
  mockDialogSave,
  mockFsWriteFile,
  mockOpenUrl,
  mockProcessRelaunch,
  mockRevealItemInDir,
  mockSecretsBackend,
  mockTauriInvoke,
  mockTauriListen,
  mockUpdaterCheck,
  resetMockTauri,
} from "@/test/fakes/mockTauri";
import {
  createDomRect,
  installRangeGeometryPolyfill,
} from "@/test/helpers/domGeometry";

// ============================================================================
// External / Native Boundary Mocks (Tauri IPC, SQLite, Window, react-pdf)
// ============================================================================

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockTauriInvoke,
  convertFileSrc: mockConvertFileSrc,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockTauriListen,
  emit: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: mockDialogSave,
  open: mockDialogOpen,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: mockFsWriteFile,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
  revealItemInDir: mockRevealItemInDir,
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(async () => "windows"),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: MockLazyStore,
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockUpdaterCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mockProcessRelaunch,
  exit: vi.fn(async () => {}),
}));

vi.mock("@/services/window", () => ({
  WindowService: MockWindowService,
}));

vi.mock("@/services/storage/database", () => ({
  DocumentDatabase: MockDocumentDatabase,
}));

vi.mock("react-pdf", () => mockReactPdfModule);

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "mock-pdf-worker.mjs",
}));

// ============================================================================
// JSDOM Polyfills
// ============================================================================

installRangeGeometryPolyfill();

class MockResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    const rect = target.getBoundingClientRect();
    const width = rect.width || 1200;
    const height = rect.height || 1800;
    const entry = {
      target,
      contentRect: createDomRect(0, 0, width, height),
      borderBoxSize: [{ blockSize: height, inlineSize: width }],
      contentBoxSize: [{ blockSize: height, inlineSize: width }],
      devicePixelContentBoxSize: [{ blockSize: height, inlineSize: width }],
    } as unknown as ResizeObserverEntry;
    queueMicrotask(() => {
      try {
        this.callback([entry], this);
      } catch {
        // Ignore observer callback errors after unmount
      }
    });
  }

  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = MockResizeObserver;
} else {
  globalThis.ResizeObserver = MockResizeObserver;
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Provide a default non-zero viewport height on scroll containers for @tanstack/react-virtual,
  // realistic layout rects for react-resizable-panels groups/handles (so separator hit-testing
  // at x=840 never hijacks JSDOM pointer clicks at (0,0)), and ProseMirror editors.
  const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rect = origGetBoundingClientRect.call(this);
    if (rect.width === 0 && rect.height === 0 && this instanceof HTMLElement) {
      const slot = this.getAttribute("data-slot");
      if (slot === "resizable-panel-group") {
        return createDomRect(0, 0, 1200, 800);
      }
      if (slot === "resizable-handle") {
        return createDomRect(840, 0, 4, 800);
      }
      if (
        typeof this.className === "string" &&
        this.className.includes("overflow-auto")
      ) {
        return createDomRect(0, 0, 1200, 1800);
      }
      if (
        this.classList.contains("ProseMirror") ||
        this.closest(".ProseMirror")
      ) {
        return createDomRect(0, 0, 600, 400);
      }
    }
    return rect;
  };

  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (
        typeof this.className === "string" &&
        this.className.includes("overflow-auto")
      ) {
        return 1200;
      }
      return Math.round(this.getBoundingClientRect().width);
    },
  });

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (
        typeof this.className === "string" &&
        this.className.includes("overflow-auto")
      ) {
        return 1800;
      }
      return Math.round(this.getBoundingClientRect().height);
    },
  });

  Object.defineProperty(window, "scrollBy", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });

  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }

  document.elementFromPoint = vi.fn(() => {
    const pm = document.querySelector(".ProseMirror");
    if (pm) {
      return (pm.querySelector("p, h1, h2, h3") as Element | null) ?? pm;
    }
    return document.body;
  });

  if (typeof (document as any).caretRangeFromPoint !== "function") {
    (document as any).caretRangeFromPoint = vi.fn(() => {
      const range = document.createRange();
      const pm = document.querySelector(".ProseMirror");
      const target = pm?.querySelector("p, h1, h2, h3") ?? pm ?? document.body;
      range.setStart(target, 0);
      range.collapse(true);
      return range;
    });
  }

  // Canvas 2D context & toDataURL polyfill for figure cropper / PdfPage back-buffer
  const mockCanvasContext2d = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    putImageData: vi.fn(),
    createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  };

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: vi.fn(() => mockCanvasContext2d),
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: vi.fn(() => SAMPLE_PNG_DATA_URL),
  });

  // Auto-load data:image/* in JSDOM so docx export's Image dimension probe resolves
  class MockImage {
    public naturalWidth = 200;
    public naturalHeight = 120;
    public width = 200;
    public height = 120;
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    private _src = "";

    get src(): string {
      return this._src;
    }

    set src(value: string) {
      this._src = value;
      queueMicrotask(() => {
        if (value.startsWith("data:image/")) {
          this.onload?.();
        } else {
          this.onerror?.();
        }
      });
    }
  }
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    writable: true,
    value: MockImage,
  });

  // Clipboard polyfill
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {}),
        readText: vi.fn(async () => ""),
      },
    });
  }
}

// ============================================================================
// Store & Service Resets Between Tests
// ============================================================================

import { DEFAULT_AI_SETTINGS, DEFAULT_RAG_HYPERPARAMETERS } from "@/constants/models";
import { DEFAULT_SELECT_TOOL, DEFAULT_TOOL_PRESETS } from "@/constants/tools";
import { clearResolvedCropCache } from "@/services/cropResolver";
import { LlmService } from "@/services/llm";
import { RagService } from "@/services/rag";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useRagStore } from "@/stores/ragStore";
import { useSummaryStore } from "@/stores/summaryStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToolStore } from "@/stores/toolStore";

export function resetAllTestState(): void {
  localStorage.clear();
  mockDatabase.reset();
  resetMockTauri();
  resetMockPdfViewer();
  mockLlm.reset();
  clearResolvedCropCache();
  RagService.invalidateDocumentChunks();

  useAnnotationStore.getState().clear();
  useDocumentStore.getState().closeDocument();
  useLibraryStore.setState({
    documents: [],
    collections: [],
    isClearing: false,
  });
  useToolStore.setState({
    presets: [...DEFAULT_TOOL_PRESETS],
    activeState: { ...DEFAULT_SELECT_TOOL },
  });
  useSystemStore.setState({
    platform: "windows",
    theme: "dark",
    pdfDarkMode: "smart",
    defaultZoom: 100,
    sidebarOpen: false,
    isMac: false,
    isWindows: true,
    isLinux: false,
    shortcutModifier: "Ctrl",
    isDark: true,
  });
  useAiStudioStore.setState({
    isAiStudioOpen: false,
    activeAiTab: "chat",
  });
  mockSecretsBackend.apiKeys.openrouter = "sk-test-openrouter";
  useAiConfigStore.setState({
    llmProvider: DEFAULT_AI_SETTINGS.llmProvider,
    llmModel: DEFAULT_AI_SETTINGS.llmModel,
    apiKeys: {
      openrouter: "sk-test-openrouter",
      "google-ai-studio": "",
      ollama: "",
      openai: "",
      anthropic: "",
    },
    ollamaEndpoint: DEFAULT_AI_SETTINGS.ollamaEndpoint,
    webSearchEnabled: false,
    embeddingProvider: DEFAULT_AI_SETTINGS.embeddingProvider,
    embeddingModel: DEFAULT_AI_SETTINGS.embeddingModel,
    embeddingApiKey: "",
    hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },
    secretsHydrated: false,
  });
  useChatStore.getState().cancelStreaming();
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    pendingContextSnippet: null,
  });
  useChatStore.getState().setViewerJumpHandler(null);
  useRagStore.setState({
    localModelStatus: {
      provider: "local-rust",
      modelId: DEFAULT_AI_SETTINGS.embeddingModel,
      isAvailable: true,
      isDownloading: false,
      fileSizeMb: 23,
    },
    downloadProgress: null,
    isDownloadingModel: false,
    downloadedModels: [],
    isDeletingModel: false,
    isIndexing: false,
    indexingDocId: null,
    indexingProgress: 0,
    indexingProgressDetail: null,
    indexingError: null,
    catalog: { documents: [] },
    inspectedChunks: [],
    isLoadingChunks: false,
    ragQuery: "",
    ragResults: [],
    isSearchingRag: false,
    searchScope: "current",
    activeRagHighlight: null,
  });
  useSummaryStore.getState().cancelSummaryStreaming();
  useSummaryStore.getState().setPdfProxy(null);
  useSummaryStore.setState({
    activeSummary: null,
    previousSummary: null,
    isLoadingSummary: false,
    isSummarizing: false,
    isSummaryWorkspaceOpen: false,
    summaryFocusMode: "study",
    chapters: [],
    selectedChapterId: "all",
    generationProgress: null,
    lastCompressionStats: null,
  });
}

beforeEach(() => {
  resetAllTestState();
  vi.spyOn(LlmService, "streamChat").mockImplementation((options) =>
    mockLlm.streamChat(options),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});
