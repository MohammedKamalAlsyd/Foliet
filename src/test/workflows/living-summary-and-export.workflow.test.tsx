import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { AiStudioSidebar } from "@/components/ai/AiStudioSidebar";
import { getCachedCrop } from "@/services/cropResolver";
import { insertFigureIntoSummary } from "@/services/figureCropper";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSummaryStore } from "@/stores/summaryStore";
import { SAMPLE_PNG_DATA_URL, mockDatabase } from "@/test/fakes/mockDatabase";
import { mockLlm } from "@/test/fakes/mockLlm";
import { createMockPdfProxy } from "@/test/fakes/mockPdfViewer";
import {
  mockDialogSave,
  mockFsWriteFile,
  writtenFiles,
} from "@/test/fakes/mockTauri";
import type { CropAnnotation, PdfAnnotation } from "@/types/annotations";
import type { DocumentItem, PdfChapter } from "@/types/document";
import { upsertChapterSection } from "@/utils/summaryUtils";
import {
  compressChatHistory,
  compressDocumentText,
  compressRagPassages,
} from "@/utils/tokenCompressor";

const SUMMARY_DOC: DocumentItem = {
  id: "doc-summary-2page",
  title: "Neural Retrieval Paper",
  pages: 2,
  filePath: "/mock/sample-2page.pdf",
  lastPage: 1,
  zoom: 100,
};

const TWO_CHAPTERS: PdfChapter[] = [
  {
    id: "ch-1",
    title: "Introduction",
    startPage: 1,
    endPage: 1,
    level: 0,
  },
  {
    id: "ch-2",
    title: "Experimental Architecture",
    startPage: 2,
    endPage: 2,
    level: 0,
  },
];

const SAMPLE_ANNOTATIONS: PdfAnnotation[] = [
  {
    id: "hl-1",
    pageNumber: 1,
    toolType: "highlight",
    color: "#EAB308",
    text: "Dense semantic retrieval accelerates scholarly reading",
    rectSegments: [{ x: 0.1, y: 0.12, width: 0.5, height: 0.02 }],
    x: 0.1,
    y: 0.12,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "hl-2",
    pageNumber: 2,
    toolType: "highlight",
    color: "#EAB308",
    text: "normalized coordinates remain invariant",
    rectSegments: [{ x: 0.1, y: 0.4, width: 0.4, height: 0.02 }],
    x: 0.1,
    y: 0.4,
    createdAt: "2026-01-01T00:01:00Z",
  },
  {
    id: "ul-1",
    pageNumber: 1,
    toolType: "underline",
    color: "#16A34A",
    underlineStyle: "solid",
    text: "compact vector representations",
    rectSegments: [{ x: 0.1, y: 0.15, width: 0.4, height: 0.02 }],
    x: 0.1,
    y: 0.15,
    createdAt: "2026-01-01T00:02:00Z",
  },
  {
    id: "note-1",
    pageNumber: 2,
    toolType: "popup_note",
    color: "#0284C7",
    comment: "Compare latency against BM25",
    x: 0.5,
    y: 0.3,
    createdAt: "2026-01-01T00:03:00Z",
  },
  {
    id: "crop-fig1",
    pageNumber: 2,
    toolType: "area_select",
    color: "#06B6D4",
    imageUrl: "idb://crop-fig1",
    caption: "Figure 1: Neural retrieval pipeline",
    x: 0.12,
    y: 0.17,
    width: 0.34,
    height: 0.18,
    createdAt: "2026-01-01T00:04:00Z",
  },
];

function setupSummaryContext() {
  useDocumentStore.getState().openDocument(SUMMARY_DOC);
  useSummaryStore.getState().setPdfProxy(createMockPdfProxy());
  useSummaryStore.getState().setChapters(TWO_CHAPTERS);
  useAiStudioStore.setState({ isAiStudioOpen: true, activeAiTab: "summary" });
}

describe("Summary studio, zero-highlight prompting, token compression, auto-save & export workflow", () => {
  it("opens Summary Studio directly inside the Summarize tab with no intermediate launch gate and works seamlessly with 0 highlights", async () => {
    const user = userEvent.setup();
    setupSummaryContext();
    useChatStore.setState({
      conversations: [
        {
          id: "conv-1",
          docId: SUMMARY_DOC.id,
          title: "Architecture Q&A",
          createdAt: 1000,
          updatedAt: 2000,
          messages: [
            { id: "m1", role: "user", content: "Explain Fig 1", timestamp: 1000 },
          ],
        },
      ],
    });

    render(
      <AiStudioSidebar
        isOpen={true}
        onJumpToPage={vi.fn()}
        annotations={[]}
      />,
    );

    // Opens directly into Summary Studio without any "Open Summary Split View" gate
    expect(await screen.findByLabelText("Summary Studio")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open summary split view/i }),
    ).not.toBeInTheDocument();

    // Redundant "Full Book" button at the end of the composer must not exist
    expect(
      screen.queryByRole("button", { name: /^full book$/i }),
    ).not.toBeInTheDocument();

    // One-click starter prompt works with 0 highlights & sends compressed PDF text (no "missing highlights" noise)
    mockLlm.enqueueResponse({
      chunks: ["# Neural Retrieval Paper\n\n## Key Takeaways\n\nDirect PDF synthesis [Page 1]."],
    });

    await user.click(screen.getByRole("button", { name: "Key takeaways" }));

    await waitFor(() => {
      expect(useSummaryStore.getState().activeSummary?.content).toContain(
        "Direct PDF synthesis [Page 1].",
      );
    });

    const lastCall = mockLlm.calls[mockLlm.calls.length - 1];
    expect(lastCall).toBeDefined();
    expect(lastCall.systemPrompt).toContain("without mentioning missing highlights");
    expect(lastCall.messages[0].content).toContain("SOURCE TEXT");
    expect(lastCall.messages[0].content).not.toContain(
      "No text highlights or underlines selected",
    );
  });

  it("compresses PDF headers/footers, hyphenated wraps, trailing references, RAG overlap, and old chat turns to reduce tokens", () => {
    const noisyPdf = [
      "[Page 1]\nJournal of Neural Systems Vol. 14\n1\nDense seman-\ntic retrieval achieves 94% recall on academic benchmarks.\nCopyright 2026 Neural Systems",
      "[Page 2]\nJournal of Neural Systems Vol. 14\n2\nOverlapping 32-line windows preserve mathematical formu-\nlas and normalized bounding boxes.\nCopyright 2026 Neural Systems",
      "[Page 3]\nJournal of Neural Systems Vol. 14\n3\nOur evaluations confirm 14 ms local query latency in Rust.\n\nReferences\n[1] Author A. Long citation entry repeated many times. 2024.\n[2] Author B. Another long bibliography item that wastes tokens. 2025.\n[3] Author C. Third bibliography entry with DOI and publisher metadata. 2025.\nCopyright 2026 Neural Systems",
    ].join("\n\n");

    const compressed = compressDocumentText(noisyPdf, { maxChars: 2000 });
    expect(compressed.compressedChars).toBeLessThan(compressed.originalChars);
    expect(compressed.savedPercent).toBeGreaterThan(20);
    expect(compressed.text).toContain("[Page 1]");
    expect(compressed.text).toContain("[Page 2]");
    expect(compressed.text).toContain("semantic retrieval");
    expect(compressed.text).toContain("formulas");
    expect(compressed.text).not.toContain("Journal of Neural Systems Vol. 14");
    expect(compressed.text).not.toContain("Copyright 2026 Neural Systems");
    expect(compressed.text).toContain("[References omitted]");
    expect(compressed.text).not.toContain("Another long bibliography item");

    const dedupedRag = compressRagPassages([
      {
        pageNumber: 1,
        text: "Shared overlapping line between chunk one and two.\nUnique line from chunk one.",
      },
      {
        pageNumber: 1,
        text: "Shared overlapping line between chunk one and two.\nUnique line from chunk two.",
      },
    ]);
    expect(
      dedupedRag.split("Shared overlapping line between chunk one and two.").length - 1,
    ).toBe(1);
    expect(dedupedRag).toContain("Unique line from chunk two.");

    const longHistory = Array.from({ length: 10 }, (_, idx) => ({
      id: `m-${idx}`,
      role: (idx % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `Turn ${idx}: ` + "x".repeat(500),
      timestamp: idx * 1000,
    }));
    const compactHistory = compressChatHistory(longHistory, {
      maxRecentMessages: 4,
      maxOldChars: 100,
    });
    expect(compactHistory[0].content.length).toBeLessThanOrEqual(101);
    expect(compactHistory[compactHistory.length - 1].content.length).toBeGreaterThan(400);
  });

  it("generates chapter & document summaries (upsertChapterSection), refines conversationally, and restores previous snapshot", async () => {
    // Pure upsertChapterSection verification
    const initial = upsertChapterSection(
      "",
      "Neural Retrieval Paper",
      "Introduction",
      "Key overview [Page 1].",
    );
    expect(initial).toContain("# Neural Retrieval Paper");
    expect(initial).toContain("## Introduction\n\nKey overview [Page 1].");

    const replaced = upsertChapterSection(
      `${initial}\n## Experimental Architecture\n\nTwo-column results [Page 2].\n`,
      "Neural Retrieval Paper",
      "Introduction",
      "Updated overview [Page 1].",
    );
    expect(replaced).toContain("Updated overview [Page 1].");
    expect(replaced).not.toContain("Key overview [Page 1].");
    expect(replaced).toContain("## Experimental Architecture");

    const user = userEvent.setup();
    setupSummaryContext();
    useSummaryStore.setState({
      selectedChapterId: "ch-1",
    });

    render(
      <AiStudioSidebar
        isOpen={true}
        onJumpToPage={vi.fn()}
        annotations={SAMPLE_ANNOTATIONS}
      />,
    );

    // Wait for lazy SummarizationWorkspace + Tiptap editor directly inside Summarize tab
    await screen.findByLabelText("Summary Studio");
    await waitFor(() => {
      expect(document.querySelector(".ProseMirror")).not.toBeNull();
    });

    // 1. Generate Chapter 1 summary
    mockLlm.enqueueResponse({
      chunks: ["## Introduction\n\nDense retrieval overview [Page 1]."],
    });
    await user.click(
      screen.getByRole("button", { name: /summarize chapter/i }),
    );

    await waitFor(() => {
      expect(useSummaryStore.getState().activeSummary?.content).toContain(
        "Dense retrieval overview [Page 1].",
      );
    });
    const savedCh1 = await mockDatabase.getSummary(SUMMARY_DOC.id);
    expect(savedCh1?.content).toContain("## Introduction");

    // 2. Switch scope selector to Entire Document and summarize across both chapters
    mockLlm.enqueueResponse({
      chunks: ["## Introduction\n\nFull book Ch 1 summary [Page 1]."],
    });
    mockLlm.enqueueResponse({
      chunks: [
        "## Experimental Architecture\n\nFull book Ch 2 architecture [Page 2].",
      ],
    });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Target chapter" }),
      "all",
    );
    await user.click(screen.getByRole("button", { name: /^summarize$/i }));

    await waitFor(() => {
      const content = useSummaryStore.getState().activeSummary?.content ?? "";
      expect(content).toContain("Full book Ch 1 summary [Page 1].");
      expect(content).toContain("Full book Ch 2 architecture [Page 2].");
    });

    // 3. Conversational refinement -> creates backup snapshot and exposes Restore button
    mockLlm.enqueueResponse({
      chunks: [
        "# Neural Retrieval Paper\n\n## Refined Synthesis\n\nConcise refined notes [Page 2].\n",
      ],
    });

    const refineInput = screen.getByPlaceholderText(/refine summary/i);
    await user.type(refineInput, "Condense into a single refined synthesis");
    await user.click(screen.getByRole("button", { name: /apply/i }));

    await waitFor(() => {
      expect(useSummaryStore.getState().activeSummary?.content).toContain(
        "Concise refined notes [Page 2].",
      );
    });

    // 4. Click Restore -> restores pre-refinement full-book snapshot
    const restoreBtn = await screen.findByRole("button", { name: /restore/i });
    await user.click(restoreBtn);

    await waitFor(() => {
      expect(useSummaryStore.getState().activeSummary?.content).toMatch(
        /Full book Ch 2 architecture \\?\[Page 2\\?\]\./,
      );
    });
    const restoredDb = await mockDatabase.getSummary(SUMMARY_DOC.id);
    expect(restoredDb?.content).toMatch(
      /Full book Ch 2 architecture \\?\[Page 2\\?\]\./,
    );
  });

  it("embeds figures via Insert in Summary, crop drag-drop, and OS image drop (<= 5 MB accepted, > 5 MB rejected) with idb:// crop cache resolution", async () => {
    setupSummaryContext();
    await mockDatabase.saveFigureCrop(
      "crop-fig1",
      SAMPLE_PNG_DATA_URL,
      SUMMARY_DOC.id,
    );
    await mockDatabase.saveFigureCrop(
      "crop-fig2",
      SAMPLE_PNG_DATA_URL,
      SUMMARY_DOC.id,
    );
    await mockDatabase.saveSummary(
      SUMMARY_DOC.id,
      "# Neural Retrieval Paper\n\nInitial notes.\n",
    );
    useSummaryStore.setState({ isSummaryWorkspaceOpen: true });

    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");

    render(
      <AiStudioSidebar
        isOpen={true}
        onJumpToPage={vi.fn()}
        annotations={SAMPLE_ANNOTATIONS}
      />,
    );

    const proseMirror = await waitFor(() => {
      const el = document.querySelector(".ProseMirror") as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });

    // 1. Insert via "Insert in Summary" bridge (`foliet:insert-summary-image`)
    const crop1 = SAMPLE_ANNOTATIONS.find(
      (a) => a.id === "crop-fig1",
    ) as CropAnnotation;
    await act(async () => {
      await insertFigureIntoSummary(crop1, SUMMARY_DOC.id);
    });

    await waitFor(() => {
      const img = document.querySelector(
        'img[alt="Figure 1: Neural retrieval pipeline"]',
      ) as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe(SAMPLE_PNG_DATA_URL);
    });
    expect(getCachedCrop("idb://crop-fig1")).toBe(SAMPLE_PNG_DATA_URL);

    // 2. Drag-and-drop `application/x-foliet-crop` payload
    const cropDropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(cropDropEvent, "clientX", { value: 10 });
    Object.defineProperty(cropDropEvent, "clientY", { value: 10 });
    Object.defineProperty(cropDropEvent, "dataTransfer", {
      value: {
        types: ["application/x-foliet-crop"],
        files: [],
        getData: (mime: string) =>
          mime === "application/x-foliet-crop"
            ? JSON.stringify({
                src: "idb://crop-fig2",
                alt: "Dragged Figure 2",
              })
            : "",
      },
    });
    act(() => {
      proseMirror.dispatchEvent(cropDropEvent);
    });

    await waitFor(() => {
      const draggedImg = document.querySelector(
        'img[alt="Dragged Figure 2"]',
      ) as HTMLImageElement | null;
      expect(draggedImg).not.toBeNull();
      expect(draggedImg?.getAttribute("src")).toBe(SAMPLE_PNG_DATA_URL);
    });
    expect(getCachedCrop("idb://crop-fig2")).toBe(SAMPLE_PNG_DATA_URL);

    // 3. Drop valid OS image file (<= 5 MB)
    const smallFile = new File([new Uint8Array([137, 80, 78, 71])], "chart.png", {
      type: "image/png",
    });
    const smallDropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(smallDropEvent, "clientX", { value: 10 });
    Object.defineProperty(smallDropEvent, "clientY", { value: 10 });
    Object.defineProperty(smallDropEvent, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [smallFile],
        getData: () => "",
      },
    });
    act(() => {
      proseMirror.dispatchEvent(smallDropEvent);
    });

    await waitFor(() => {
      const osImg = document.querySelector(
        'img[alt="chart.png"]',
      ) as HTMLImageElement | null;
      expect(osImg).not.toBeNull();
      expect(osImg?.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    });

    // 4. Drop oversized OS image file (> 5 MB) -> rejected with toast error
    const bigFile = new File([new Uint8Array([1, 2, 3])], "huge.png", {
      type: "image/png",
    });
    Object.defineProperty(bigFile, "size", { value: 6 * 1024 * 1024 });
    const bigDropEvent = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(bigDropEvent, "clientX", { value: 10 });
    Object.defineProperty(bigDropEvent, "clientY", { value: 10 });
    Object.defineProperty(bigDropEvent, "dataTransfer", {
      value: {
        types: ["Files"],
        files: [bigFile],
        getData: () => "",
      },
    });
    act(() => {
      proseMirror.dispatchEvent(bigDropEvent);
    });

    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Dropped image exceeds the 5 MB size limit.",
    );
    expect(document.querySelector('img[alt="huge.png"]')).toBeNull();
  });

  it("auto-saves edits after 700ms debounce and flushes pending edits immediately when closing Split View", async () => {
    setupSummaryContext();
    await mockDatabase.saveSummary(SUMMARY_DOC.id, "# Initial Draft\n");
    useSummaryStore.setState({ isSummaryWorkspaceOpen: true });

    render(
      <AiStudioSidebar
        isOpen={true}
        onJumpToPage={vi.fn()}
        annotations={SAMPLE_ANNOTATIONS}
      />,
    );

    const proseMirror = await waitFor(() => {
      const el = document.querySelector(".ProseMirror") as HTMLElement | null;
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain("Initial Draft");
      return el!;
    });

    // Activate fake timers once workspace + Tiptap are mounted and loaded
    vi.useFakeTimers();

    // Trigger an editor update by clicking the Blockquote toolbar button (or inserting a crop)
    const cropDrop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(cropDrop, "clientX", { value: 10 });
    Object.defineProperty(cropDrop, "clientY", { value: 10 });
    Object.defineProperty(cropDrop, "dataTransfer", {
      value: {
        types: ["application/x-foliet-crop"],
        files: [],
        getData: (mime: string) =>
          mime === "application/x-foliet-crop"
            ? JSON.stringify({ src: SAMPLE_PNG_DATA_URL, alt: "AutoSave Fig 1" })
            : "",
      },
    });

    act(() => {
      proseMirror.dispatchEvent(cropDrop);
    });

    // Before 700ms: DB should still have the initial draft (saveStatus === "Saving")
    expect(screen.getByText("Saving")).toBeInTheDocument();
    expect((await mockDatabase.getSummary(SUMMARY_DOC.id))?.content).not.toContain(
      "AutoSave Fig 1",
    );

    // Advance past 700ms debounce -> flushed to DB
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect((await mockDatabase.getSummary(SUMMARY_DOC.id))?.content).toContain(
      "AutoSave Fig 1",
    );

    // Make a second edit and immediately close Split View BEFORE 700ms -> must flush immediately
    const cropDrop2 = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(cropDrop2, "clientX", { value: 10 });
    Object.defineProperty(cropDrop2, "clientY", { value: 10 });
    Object.defineProperty(cropDrop2, "dataTransfer", {
      value: {
        types: ["application/x-foliet-crop"],
        files: [],
        getData: (mime: string) =>
          mime === "application/x-foliet-crop"
            ? JSON.stringify({ src: SAMPLE_PNG_DATA_URL, alt: "CloseFlush Fig 2" })
            : "",
      },
    });
    act(() => {
      proseMirror.dispatchEvent(cropDrop2);
    });

    expect((await mockDatabase.getSummary(SUMMARY_DOC.id))?.content).not.toContain(
      "CloseFlush Fig 2",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close AI Studio" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useSummaryStore.getState().isSummaryWorkspaceOpen).toBe(false);
    expect((await mockDatabase.getSummary(SUMMARY_DOC.id))?.content).toContain(
      "CloseFlush Fig 2",
    );
  });

  it("supports Copy Markdown, Standalone .md export (expanding idb:// URIs & handling cancel), and lazy-loaded .docx export", async () => {
    const user = userEvent.setup();
    setupSummaryContext();
    await mockDatabase.saveFigureCrop(
      "crop-fig1",
      SAMPLE_PNG_DATA_URL,
      SUMMARY_DOC.id,
    );
    const mdWithCrop = [
      "# Neural Retrieval Paper",
      "",
      "Key finding on bounding boxes [Page 2].",
      "",
      "![Figure 1: Neural retrieval pipeline](idb://crop-fig1)",
      "",
    ].join("\n");
    await mockDatabase.saveSummary(SUMMARY_DOC.id, mdWithCrop);
    useSummaryStore.setState({ isSummaryWorkspaceOpen: true });

    const clipboardSpy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(
      <AiStudioSidebar
        isOpen={true}
        onJumpToPage={vi.fn()}
        annotations={SAMPLE_ANNOTATIONS}
      />,
    );

    await waitFor(() => {
      const pm = document.querySelector(".ProseMirror");
      expect(pm?.textContent).toContain("Key finding on bounding boxes");
    });

    // 1. Copy Markdown
    await user.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(clipboardSpy).toHaveBeenCalledTimes(1);
    expect(clipboardSpy.mock.calls[0][0]).toContain("Key finding on bounding boxes");
    expect(clipboardSpy.mock.calls[0][0]).toContain("idb://crop-fig1");

    // 2. Cancelled .md save dialog -> writeFile not called
    mockDialogSave.mockResolvedValueOnce(null);
    await user.click(screen.getByTitle("Export Markdown (.md)"));
    await waitFor(() => {
      expect(mockDialogSave).toHaveBeenCalledTimes(1);
    });
    expect(mockFsWriteFile).not.toHaveBeenCalled();

    // 3. Standalone .md export -> expands `idb://crop-fig1` into `data:image/png;base64,...`
    mockDialogSave.mockResolvedValueOnce("/mock/exports/neural-notes.md");
    await user.click(screen.getByTitle("Export Markdown (.md)"));

    await waitFor(() => {
      expect(writtenFiles.has("/mock/exports/neural-notes.md")).toBe(true);
    });
    const exportedMd = new TextDecoder().decode(
      writtenFiles.get("/mock/exports/neural-notes.md")!,
    );
    expect(exportedMd).toContain("Key finding on bounding boxes");
    expect(exportedMd).toContain(SAMPLE_PNG_DATA_URL);
    expect(exportedMd).not.toContain("idb://crop-fig1");

    // 4. Lazy-loaded .docx export -> generates valid PK/ZIP Word document bytes
    mockDialogSave.mockResolvedValueOnce("/mock/exports/neural-notes.docx");
    await user.click(screen.getByTitle("Export Word Document (.docx)"));

    await waitFor(() => {
      expect(writtenFiles.has("/mock/exports/neural-notes.docx")).toBe(true);
    });
    const docxBytes = writtenFiles.get("/mock/exports/neural-notes.docx")!;
    expect(docxBytes.byteLength).toBeGreaterThan(1000);
    // DOCX is an OOXML ZIP container starting with 'P' (0x50), 'K' (0x4B)
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
  });
});
