import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewerView } from "@/pages/ViewerView";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import { mockDatabase } from "@/test/fakes/mockDatabase";
import { mockLlm } from "@/test/fakes/mockLlm";
import { mockOpenUrl } from "@/test/fakes/mockTauri";
import { selectTextInElement } from "@/test/helpers/domGeometry";
import { isTextMarkupAnnotation } from "@/types/annotations";
import type { DocumentItem } from "@/types/document";

const TWO_PAGE_DOC: DocumentItem = {
  id: "doc-chat-2page",
  title: "Neural Retrieval Paper",
  pages: 2,
  filePath: "/mock/sample-2page.pdf",
  lastPage: 1,
  zoom: 100,
};

async function mountViewerWithAiOpen(openStudio = false) {
  useDocumentStore.getState().openDocument(TWO_PAGE_DOC);
  if (openStudio) {
    useAiStudioStore.setState({ isAiStudioOpen: true, activeAiTab: "chat" });
  }
  const rendered = render(<ViewerView />);
  await waitFor(() => {
    expect(
      rendered.container.querySelector('[data-foliet-page="1"]'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelector('[data-foliet-page="2"]'),
    ).not.toBeNull();
  });
  return rendered;
}

describe("AI chat, selection actions, copilot tools & citation spotlight workflow", () => {
  it("shows SelectionActionBar in select mode: Search Web calls openUrl (+ window.open fallback) and Ask Lio attaches snippet & focuses chat input", async () => {
    const user = userEvent.setup();
    const { container } = await mountViewerWithAiOpen(false);
    const page1 = container.querySelector(
      '[data-foliet-page="1"]',
    ) as HTMLElement;
    const page2 = container.querySelector(
      '[data-foliet-page="2"]',
    ) as HTMLElement;

    // 1. Select text on Page 1 -> Search Web calls openUrl
    selectTextInElement(page1, "Dense semantic retrieval");
    fireEvent.mouseUp(page1);

    const searchBtn = await screen.findByRole("button", { name: /search web/i });
    await user.click(searchBtn);
    expect(mockOpenUrl).toHaveBeenCalledWith(
      "https://www.google.com/search?q=Dense%20semantic%20retrieval",
    );

    // 2. Fallback to window.open when openUrl rejects
    mockOpenUrl.mockRejectedValueOnce(new Error("Opener blocked"));
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockImplementation(() => null);

    selectTextInElement(page1, "scholarly reading workflows");
    fireEvent.mouseUp(page1);
    await user.click(await screen.findByRole("button", { name: /search web/i }));

    await waitFor(() => {
      expect(windowOpenSpy).toHaveBeenCalledWith(
        "https://www.google.com/search?q=scholarly%20reading%20workflows",
        "_blank",
      );
    });

    // 3. Select text on Page 2 -> Ask Lio sets pendingContextSnippet, opens AI Studio, focuses chat input
    selectTextInElement(page2, "Left column analysis confirms that");
    fireEvent.mouseUp(page2);
    await user.click(await screen.findByRole("button", { name: /ask lio/i }));

    expect(useAiStudioStore.getState().isAiStudioOpen).toBe(true);
    expect(useAiStudioStore.getState().activeAiTab).toBe("chat");
    expect(useChatStore.getState().pendingContextSnippet).toMatchObject({
      pageNumber: 2,
      snippet: "Left column analysis confirms that",
    });

    const chatInput = await screen.findByPlaceholderText(
      "Ask about this passage...",
    );
    expect(screen.getByText("Page 2:")).toBeInTheDocument();
    await waitFor(() => {
      expect(document.activeElement).toBe(chatInput);
    });
  });

  it("persists messages to conversation DB, streams tokens into AiChatPanel, and cleanly aborts on Stop", async () => {
    const user = userEvent.setup();
    await mountViewerWithAiOpen(true);

    const stream = mockLlm.enqueueDeferredStream();
    const input = await screen.findByPlaceholderText(
      "Ask Lio about this paper...",
    );

    await user.type(input, "Summarize the core contribution");
    expect(input).toHaveValue("Summarize the core contribution");
    await user.click(screen.getByRole("button", { name: /send/i }));

    const callOptions = await stream.started;
    expect(callOptions.signal?.aborted).toBe(false);

    // User message persisted in conversation DB
    const savedDuringStream = await mockDatabase.getConversations(
      TWO_PAGE_DOC.id,
    );
    expect(savedDuringStream).toHaveLength(1);
    expect(savedDuringStream[0].messages[0].content).toContain(
      "Summarize the core contribution",
    );

    // Stream tokens incrementally
    act(() => {
      stream.pushChunk("The paper introduces ");
      stream.pushChunk("dense semantic retrieval.");
    });

    await waitFor(() => {
      expect(
        screen.getByText(/The paper introduces dense semantic retrieval\./i),
      ).toBeInTheDocument();
    });

    // Click Stop -> aborts AbortController cleanly
    const stopBtn = screen.getByRole("button", { name: /stop/i });
    await user.click(stopBtn);

    expect(callOptions.signal?.aborted).toBe(true);
    await waitFor(() => {
      expect(useChatStore.getState().isStreaming).toBe(false);
    });

    // Finalized partial + stopped message persisted in DB
    const savedAfterAbort = await mockDatabase.getConversations(
      TWO_PAGE_DOC.id,
    );
    expect(savedAfterAbort[0].messages).toHaveLength(2);
    expect(savedAfterAbort[0].messages[1].content).toContain(
      "The paper introduces dense semantic retrieval.",
    );
  });

  it("executes copilot tools (navigate_to, highlight_passage, explain_figure, add_figure_to_summary) across Page 1 & Page 2", async () => {
    const user = userEvent.setup();
    const { container } = await mountViewerWithAiOpen(true);

    const summaryEvents: CustomEvent[] = [];
    const onInsertSummaryImage = (e: Event) => {
      summaryEvents.push(e as CustomEvent);
    };
    window.addEventListener("foliet:insert-summary-image", onInsertSummaryImage);

    try {
      mockLlm.enqueueResponse({
        toolCalls: [
          {
            id: "tc-nav",
            name: "navigate_to",
            arguments: { pageNumber: 2, reason: "Inspect architecture" },
          },
          {
            id: "tc-hl",
            name: "highlight_passage",
            arguments: {
              pageNumber: 2,
              text: "Left column analysis confirms that",
              color: "#FDE047",
              label: "zoom invariance",
            },
          },
          {
            id: "tc-fig",
            name: "explain_figure",
            arguments: { pageNumber: 2, caption: "Figure 1" },
          },
          {
            id: "tc-sum",
            name: "add_figure_to_summary",
            arguments: { pageNumber: 2, caption: "Figure 1" },
          },
        ],
        chunks: [
          "I navigated to [Page 2], highlighted the key invariance finding, and added Figure 1 to your summary.",
        ],
      });

      const input = await screen.findByPlaceholderText(
        "Ask Lio about this paper...",
      );
      await user.type(input, "Analyze Figure 1 on page 2 and highlight the finding");
      await user.click(screen.getByRole("button", { name: /send/i }));

      await waitFor(() => {
        expect(useChatStore.getState().isStreaming).toBe(false);
        expect(
          screen.getByText(/Navigated to Page 2/i),
        ).toBeInTheDocument();
      });

      expect(screen.getByText(/Highlighted zoom invariance/i)).toBeInTheDocument();
      expect(screen.getByText(/Figure on Page 2/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Added figure from Page 2 to Summary/i),
      ).toBeInTheDocument();

      // Highlight persisted to DB and store with valid normalized bounding box on Page 2
      expect(
        useAnnotationStore
          .getState()
          .annotations.some(
            (a) => isTextMarkupAnnotation(a) && a.pageNumber === 2,
          ),
      ).toBe(true);
      const persistedAnnots = await mockDatabase.getAnnotations(TWO_PAGE_DOC.id);
      const persistedHighlight = persistedAnnots.find(
        (a) => isTextMarkupAnnotation(a) && a.pageNumber === 2,
      );
      expect(persistedHighlight).toBeDefined();
      if (persistedHighlight && isTextMarkupAnnotation(persistedHighlight)) {
        expect(persistedHighlight.rectSegments).toHaveLength(1);
        const seg = persistedHighlight.rectSegments[0];
        expect(seg.x).toBeGreaterThan(0);
        expect(seg.y).toBeGreaterThan(0);
        expect(seg.x + seg.width).toBeLessThanOrEqual(1);
        expect(seg.y + seg.height).toBeLessThanOrEqual(1);
      }

      // Highlight also rendered on Page 2 DOM
      const page2 = container.querySelector('[data-foliet-page="2"]')!;
      expect(
        page2.querySelector('div[style*="background-color"]'),
      ).not.toBeNull();

      // `foliet:insert-summary-image` event emitted with resolved crop URI
      expect(summaryEvents).toHaveLength(1);
      expect(summaryEvents[0].detail.docId).toBe(TWO_PAGE_DOC.id);
      expect(summaryEvents[0].detail.src).toMatch(/^idb:\/\/crop-/);
      expect(summaryEvents[0].detail.pageNumber).toBe(2);
    } finally {
      window.removeEventListener(
        "foliet:insert-summary-image",
        onInsertSummaryImage,
      );
    }
  });

  it("jumps and spotlights Page 2 when clicking [Page 2], (Page 2), or Sources chips WITHOUT showing RAG Match (100%) banner", async () => {
    const user = userEvent.setup();

    await mockDatabase.saveConversation({
      id: "conv-cite-1",
      docId: TWO_PAGE_DOC.id,
      title: "Citation Test",
      createdAt: Date.now() - 1000,
      updatedAt: Date.now(),
      messages: [
        {
          id: "m-user",
          role: "user",
          content: "Where is zoom invariance confirmed?",
          timestamp: Date.now() - 500,
        },
        {
          id: "m-assistant",
          role: "assistant",
          content:
            'The authors confirm that "Left column analysis confirms that" [Page 2] and also mention "verifies multi-page citation jumping." (Page 2).',
          timestamp: Date.now(),
          citations: [
            {
              chunkId: "cite-chunk-p2",
              docId: TWO_PAGE_DOC.id,
              docTitle: TWO_PAGE_DOC.title,
              pageNumber: 2,
              snippet: "Left column analysis confirms that",
              rectSegments: [
                { x: 72 / 612, y: 342 / 792, width: 195 / 612, height: 11 / 792 },
              ],
            },
          ],
        },
      ],
    });

    const { container } = await mountViewerWithAiOpen(true);

    // 1. Click inline `[Page 2]` citation
    const bracketCiteBtn = await screen.findByRole("button", {
      name: "[Page 2]",
    });
    await user.click(bracketCiteBtn);

    await waitFor(() => {
      const hl = useRagStore.getState().activeRagHighlight;
      expect(hl?.pageNumber).toBe(2);
      expect(hl?.highlightKind).toBe("citation");
      expect(hl?.rectSegments?.length).toBeGreaterThan(0);
    });

    // Spotlight overlay rendered on Page 2, and NO "RAG Match (100%)" banner
    const page2 = container.querySelector('[data-foliet-page="2"]')!;
    expect(page2.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText(/RAG Match/i)).not.toBeInTheDocument();

    // 2. Click inline `(Page 2)` citation
    act(() => {
      useRagStore.getState().setActiveRagHighlight(null);
    });
    const parenCiteBtn = screen.getByRole("button", { name: "(Page 2)" });
    await user.click(parenCiteBtn);

    await waitFor(() => {
      const hl = useRagStore.getState().activeRagHighlight;
      expect(hl?.pageNumber).toBe(2);
      expect(hl?.highlightKind).toBe("citation");
      expect(hl?.rectSegments?.length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/RAG Match/i)).not.toBeInTheDocument();

    // 3. Click `Sources:` `Page 2` chip
    act(() => {
      useRagStore.getState().setActiveRagHighlight(null);
    });
    const sourceChipBtn = screen.getByRole("button", { name: "Page 2" });
    await user.click(sourceChipBtn);

    await waitFor(() => {
      const hl = useRagStore.getState().activeRagHighlight;
      expect(hl?.chunkId).toBe("cite-chunk-p2");
      expect(hl?.pageNumber).toBe(2);
      expect(hl?.highlightKind).toBe("citation");
      expect(hl?.rectSegments).toHaveLength(1);
    });
    expect(screen.queryByText(/RAG Match/i)).not.toBeInTheDocument();
  });
});
