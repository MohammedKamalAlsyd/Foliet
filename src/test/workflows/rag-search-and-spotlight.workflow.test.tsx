import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewerView } from "@/pages/ViewerView";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import {
  emitRagIndexProgress,
  mockRagBackend,
  mockTauriInvoke,
} from "@/test/fakes/mockTauri";
import type { DocumentItem } from "@/types/document";

const CURRENT_DOC: DocumentItem = {
  id: "doc-rag-current",
  title: "Neural Retrieval Paper",
  pages: 2,
  filePath: "/mock/sample-2page.pdf",
  lastPage: 1,
  zoom: 100,
};

async function mountViewerOnRagTab() {
  useDocumentStore.getState().openDocument(CURRENT_DOC);
  useAiStudioStore.setState({ isAiStudioOpen: true, activeAiTab: "search" });
  const rendered = render(<ViewerView />);

  await waitFor(() => {
    expect(
      rendered.container.querySelector('[data-foliet-page="1"]'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelector('[data-foliet-page="2"]'),
    ).not.toBeNull();
    expect(
      screen.getByPlaceholderText(/search concepts in this paper/i),
    ).toBeInTheDocument();
  });

  return rendered;
}

describe("RAG search, indexing progress & spotlight banner workflow", () => {
  it("guards indexing when local ONNX model is missing or remote embedding API key is empty", async () => {
    const user = userEvent.setup();

    // 1. Missing local ONNX model guard
    useRagStore.setState({
      localModelStatus: {
        provider: "local-rust",
        modelId: "Xenova/all-MiniLM-L6-v2",
        isAvailable: false,
        isDownloading: false,
        fileSizeMb: 0,
      },
    });

    await mountViewerOnRagTab();

    expect(
      screen.getByRole("button", { name: /download local model/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /index current pdf/i }),
    ).toBeDisabled();

    // 2. Switch to Voyage AI remote provider with missing API key
    await user.click(
      screen.getByTitle("Configure Embedding Provider, Model & Storage"),
    );
    const providerSelect = screen.getByDisplayValue("Local ONNX (Rust CPU)");
    await user.selectOptions(providerSelect, "voyage");
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(
      await screen.findByText(/API key required for voyage\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /index current pdf/i }),
    ).toBeDisabled();

    // Providing an API key re-enables indexing
    act(() => {
      void useAiConfigStore.getState().setEmbeddingApiKey("pa-test-key");
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /index current pdf/i }),
      ).not.toBeDisabled();
    });
  });

  it("reports scanned-PDF error with Retry and streams extracting -> chunking -> embedding -> saving stages on retry", async () => {
    const user = userEvent.setup();
    await mountViewerOnRagTab();

    // First attempt fails as a scanned PDF
    let attempt = 0;
    let resolveIndex!: (res: { chunkCount: number }) => void;

    mockRagBackend.indexHandler = async (scope) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error(
          "No extractable text found in PDF. This document appears to be scanned.",
        );
      }
      return new Promise<{ chunkCount: number }>((resolve) => {
        resolveIndex = (res) => {
          mockRagBackend.catalog = {
            documents: [
              {
                docId: scope.docId,
                docTitle: scope.docTitle,
                filePath: scope.filePath,
                chunkCount: res.chunkCount,
                indexedAt: new Date().toISOString(),
                embeddingModel: "Xenova/all-MiniLM-L6-v2",
                provider: "local-rust",
              },
            ],
          };
          resolve(res);
        };
      });
    };

    await user.click(screen.getByRole("button", { name: /index current pdf/i }));

    expect(
      await screen.findByText(/appears to be scanned/i),
    ).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });

    // Click Retry -> verify all 4 indexing stages render cleanly
    await user.click(retryBtn);

    const stages: Array<{
      stage: "extracting" | "chunking" | "embedding" | "saving";
      label: string;
      percent: number;
      currentPage: number;
      processedChunks: number;
    }> = [
      {
        stage: "extracting",
        label: "Extracting text",
        percent: 20,
        currentPage: 1,
        processedChunks: 0,
      },
      {
        stage: "chunking",
        label: "Filtering & chunking",
        percent: 45,
        currentPage: 2,
        processedChunks: 2,
      },
      {
        stage: "embedding",
        label: "Generating embeddings",
        percent: 75,
        currentPage: 2,
        processedChunks: 3,
      },
      {
        stage: "saving",
        label: "Saving index",
        percent: 95,
        currentPage: 2,
        processedChunks: 4,
      },
    ];

    for (const s of stages) {
      act(() => {
        emitRagIndexProgress({
          docId: CURRENT_DOC.id,
          stage: s.stage,
          currentPage: s.currentPage,
          totalPages: 2,
          processedChunks: s.processedChunks,
          totalChunks: 4,
          percent: s.percent,
        });
      });
      expect(await screen.findByText(s.label)).toBeInTheDocument();
      expect(screen.getByText(`${s.percent}%`)).toBeInTheDocument();
    }

    act(() => {
      resolveIndex({ chunkCount: 4 });
    });

    expect(await screen.findByText("Indexed (4 chunks)")).toBeInTheDocument();
  });

  it("switches scope (This PDF vs All PDFs), tunes topK & similarityThreshold, renders RAG Match (XX%) on Page 2 with dismiss, and opens external PDF at result.pageNumber", async () => {
    const user = userEvent.setup();

    const externalDoc = {
      docId: "doc-external-99",
      docTitle: "External Benchmark Study",
      filePath: "/mock/external-study.pdf",
      chunkCount: 6,
      indexedAt: new Date().toISOString(),
      embeddingModel: "Xenova/all-MiniLM-L6-v2",
      provider: "local-rust" as const,
    };

    mockRagBackend.catalog = {
      documents: [
        {
          docId: CURRENT_DOC.id,
          docTitle: CURRENT_DOC.title,
          filePath: CURRENT_DOC.filePath!,
          chunkCount: 3,
          indexedAt: new Date().toISOString(),
          embeddingModel: "Xenova/all-MiniLM-L6-v2",
          provider: "local-rust",
        },
        externalDoc,
      ],
    };

    mockRagBackend.chunksByDoc.set(CURRENT_DOC.id, [
      {
        chunkId: "chunk-p2-match",
        pageNumber: 2,
        chunkIndex: 0,
        text: "Left column analysis confirms that normalized coordinates remain invariant.",
        rectSegments: [
          { x: 72 / 612, y: 342 / 792, width: 195 / 612, height: 11 / 792 },
        ],
      },
    ]);

    mockRagBackend.chunksByDoc.set(externalDoc.docId, [
      {
        chunkId: "chunk-ext-p5",
        pageNumber: 5,
        chunkIndex: 0,
        text: "External benchmark study reports normalized coordinates stability.",
        rectSegments: [{ x: 0.1, y: 0.3, width: 0.5, height: 0.02 }],
      },
    ]);

    useRagStore.setState({ catalog: mockRagBackend.catalog });

    const { container } = await mountViewerOnRagTab();

    // 1. Adjust topK and similarityThreshold via Hyperparameters popover
    const hyperTrigger = screen.getByTitle(
      "RAG Hyperparameters: Top-K & Similarity Threshold",
    );
    await user.click(hyperTrigger);
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(2);
    fireEvent.change(sliders[0], { target: { value: "8" } });
    fireEvent.change(sliders[1], { target: { value: "0.6" } });
    await user.click(hyperTrigger); // close popover

    expect(useAiConfigStore.getState().hyperparameters.topK).toBe(8);
    expect(
      useAiConfigStore.getState().hyperparameters.similarityThreshold,
    ).toBeCloseTo(0.6, 2);
    expect(screen.getByText(/K=8 · 60%/i)).toBeInTheDocument();

    // 2. Search within "This PDF" scope
    const searchInput = screen.getByPlaceholderText(
      /search concepts in this paper/i,
    );
    await user.type(searchInput, "normalized coordinates");
    expect(searchInput).toHaveValue("normalized coordinates");
    fireEvent.submit(searchInput.closest("form")!);

    const currentHitText = await screen.findByText(
      /Left column analysis confirms that normalized coordinates/i,
    );
    expect(currentHitText).toBeInTheDocument();

    // Verify rag_search IPC received targetDocId + updated hyperparameters
    const ragSearchCall = mockTauriInvoke.mock.calls.find(
      ([cmd]) => cmd === "rag_search",
    );
    expect(ragSearchCall?.[1]?.query).toMatchObject({
      query: "normalized coordinates",
      targetDocId: CURRENT_DOC.id,
      topK: 8,
      similarityThreshold: 0.6,
    });

    // Click same-PDF Page 2 result -> renders rectSegments on Page 2 AND shows "RAG Match (88%)" banner
    await user.click(currentHitText);

    await waitFor(() => {
      expect(screen.getByText("RAG Match (88%)")).toBeInTheDocument();
    });

    const page2 = container.querySelector('[data-foliet-page="2"]')!;
    expect(page2.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.getByLabelText("RAG search highlight")).toBeInTheDocument();

    // Dismiss banner via X button
    await user.click(screen.getByTitle("Dismiss RAG highlight"));
    expect(screen.queryByText("RAG Match (88%)")).not.toBeInTheDocument();
    expect(useRagStore.getState().activeRagHighlight).toBeNull();

    // 3. Switch scope to "All PDFs (2)" and click external PDF result -> calls openDocument with lastPage: 5
    const openDocSpy = vi.spyOn(useDocumentStore.getState(), "openDocument");
    await user.click(screen.getByRole("button", { name: /All PDFs \(2\)/i }));
    expect(useRagStore.getState().searchScope).toBe("all");

    const allScopeInput = screen.getByPlaceholderText(
      /search all indexed research papers/i,
    );
    fireEvent.submit(allScopeInput.closest("form")!);

    const externalHit = await screen.findByText(
      /External benchmark study reports normalized coordinates/i,
    );
    await user.click(externalHit);

    expect(openDocSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: externalDoc.docId,
        title: externalDoc.docTitle,
        filePath: externalDoc.filePath,
        lastPage: 5,
      }),
    );
    expect(useDocumentStore.getState().activeDoc?.id).toBe(externalDoc.docId);
    expect(useDocumentStore.getState().activeDoc?.lastPage).toBe(5);
  });
});
