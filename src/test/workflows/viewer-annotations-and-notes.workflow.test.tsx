import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ViewerView } from "@/pages/ViewerView";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useToolStore } from "@/stores/toolStore";
import { selectTextInElement, setElementRect } from "@/test/helpers/domGeometry";
import {
  isInkAnnotation,
  isNoteAnnotation,
  isTextMarkupAnnotation,
} from "@/types/annotations";
import type { DocumentItem } from "@/types/document";

const TWO_PAGE_DOC: DocumentItem = {
  id: "doc-annot-2page",
  title: "Two Page Annotated Paper",
  pages: 2,
  filePath: "/mock/sample-2page.pdf",
  lastPage: 1,
  zoom: 100,
};

async function mountTwoPageViewer() {
  useDocumentStore.getState().openDocument(TWO_PAGE_DOC);
  const rendered = render(<ViewerView />);

  await waitFor(() => {
    expect(
      rendered.container.querySelector('[data-foliet-page="1"]'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelector('[data-foliet-page="2"]'),
    ).not.toBeNull();
  });

  const page1 = rendered.container.querySelector(
    '[data-foliet-page="1"]',
  ) as HTMLElement;
  const page2 = rendered.container.querySelector(
    '[data-foliet-page="2"]',
  ) as HTMLElement;

  return { ...rendered, page1, page2 };
}

describe("Viewer annotations, notes, eraser & undo/redo workflow", () => {
  it("switches tools in PdfToolbar and creates highlight, dashed underline, and 5px ink across Page 1 and Page 2", async () => {
    const user = userEvent.setup();
    const { page1, page2 } = await mountTwoPageViewer();

    // Default tool is Select
    expect(useToolStore.getState().activeState.toolType).toBe("select");
    expect(screen.getByRole("button", { name: /select/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // 1. Switch to Yellow Highlight via toolbar dropdown and highlight text on Page 1
    await user.click(
      screen.getByRole("button", { name: "Choose annotation tool" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Yellow Highlight/i }),
    );
    expect(useToolStore.getState().activeState.toolType).toBe("highlight");

    selectTextInElement(page1, "Dense semantic retrieval");
    fireEvent.mouseUp(page1);

    const annotsAfterHighlight = useAnnotationStore.getState().annotations;
    expect(annotsAfterHighlight).toHaveLength(1);
    const hl = annotsAfterHighlight[0];
    expect(isTextMarkupAnnotation(hl)).toBe(true);
    if (isTextMarkupAnnotation(hl)) {
      expect(hl.pageNumber).toBe(1);
      expect(hl.toolType).toBe("highlight");
      expect(hl.text).toBe("Dense semantic retrieval");
      expect(hl.rectSegments.length).toBeGreaterThan(0);
    }

    // 2. Switch to Green Underline, change underline style to "dashed", and annotate Page 2
    await user.click(
      screen.getByRole("button", { name: "Choose annotation tool" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /Green Underline/i }),
    );
    expect(useToolStore.getState().activeState.toolType).toBe("underline");

    await user.click(screen.getByRole("button", { name: "Tool style options" }));
    await user.click(await screen.findByRole("button", { name: "dashed" }));
    expect(useToolStore.getState().activeState.underlineStyle).toBe("dashed");

    selectTextInElement(page2, "Left column analysis confirms that");
    fireEvent.mouseUp(page2);

    const underline = useAnnotationStore
      .getState()
      .annotations.find(
        (a) => isTextMarkupAnnotation(a) && a.toolType === "underline",
      );
    expect(underline).toBeDefined();
    if (underline && isTextMarkupAnnotation(underline)) {
      expect(underline.pageNumber).toBe(2);
      expect(underline.underlineStyle).toBe("dashed");
      expect(underline.text).toBe("Left column analysis confirms that");
    }

    // 3. Switch to Pen (freehand_write), pick 5px thickness, draw ink stroke on Page 2
    await user.click(
      screen.getByRole("button", { name: "Choose annotation tool" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Pen/i }));
    expect(useToolStore.getState().activeState.toolType).toBe("freehand_write");

    await user.click(screen.getByRole("button", { name: "Tool style options" }));
    await user.click(await screen.findByRole("button", { name: "5px" }));
    expect(useToolStore.getState().activeState.strokeWidth).toBe(5);

    setElementRect(page2, { left: 40, top: 840, width: 612, height: 792 });
    const page2Overlay = page2.querySelector(".touch-none") as HTMLElement;
    expect(page2Overlay).not.toBeNull();

    fireEvent.pointerDown(page2Overlay, {
      button: 0,
      pointerId: 1,
      clientX: 140,
      clientY: 940,
    });
    fireEvent.pointerMove(page2Overlay, {
      button: 0,
      pointerId: 1,
      clientX: 260,
      clientY: 980,
    });
    fireEvent.pointerUp(page2Overlay, {
      button: 0,
      pointerId: 1,
      clientX: 260,
      clientY: 980,
    });

    const ink = useAnnotationStore.getState().annotations.find(isInkAnnotation);
    expect(ink).toBeDefined();
    expect(ink?.pageNumber).toBe(2);
    expect(ink?.strokeWidth).toBe(5);
    expect(ink?.points.length).toBeGreaterThanOrEqual(2);
  });

  it("handles NoteEditorPortal 300ms debounced updates, blur/close flush, and delete canceling pending debounce", async () => {
    const { page1 } = await mountTwoPageViewer();

    // Activate Note tool
    act(() => {
      useToolStore.getState().togglePreset("preset-note-cyan");
    });
    expect(useToolStore.getState().activeState.toolType).toBe("popup_note");

    setElementRect(page1, { left: 40, top: 20, width: 612, height: 792 });
    const overlay = page1.querySelector(".touch-none") as HTMLElement;

    // Switch to fake timers now that ViewerView is mounted
    vi.useFakeTimers();

    fireEvent.pointerDown(overlay, {
      button: 0,
      pointerId: 1,
      clientX: 200,
      clientY: 220,
    });

    const textarea = screen.getByPlaceholderText(
      "Write a note",
    ) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    // 1. 300ms debounce: edit does not commit until 300ms passes
    fireEvent.change(textarea, { target: { value: "Debounced comment" } });
    const noteBeforeDebounce = useAnnotationStore
      .getState()
      .annotations.find(isNoteAnnotation);
    expect(noteBeforeDebounce?.comment).toBe("");

    act(() => {
      vi.advanceTimersByTime(310);
    });
    expect(
      useAnnotationStore.getState().annotations.find(isNoteAnnotation)?.comment,
    ).toBe("Debounced comment");

    // 2. Blur flushes pending edit immediately without waiting 300ms
    fireEvent.change(textarea, { target: { value: "Flushed on blur" } });
    expect(
      useAnnotationStore.getState().annotations.find(isNoteAnnotation)?.comment,
    ).toBe("Debounced comment");
    fireEvent.blur(textarea);
    expect(
      useAnnotationStore.getState().annotations.find(isNoteAnnotation)?.comment,
    ).toBe("Flushed on blur");

    // 3. Close button flushes pending edit immediately
    fireEvent.change(textarea, { target: { value: "Flushed on close" } });
    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    expect(
      useAnnotationStore.getState().annotations.find(isNoteAnnotation)?.comment,
    ).toBe("Flushed on close");
    expect(screen.queryByPlaceholderText("Write a note")).not.toBeInTheDocument();

    // 4. Re-open note, type a pending edit, and Delete before 300ms -> cancels debounce cleanly
    act(() => {
      useToolStore.getState().setSelectMode();
    });
    const notePin = page1.querySelector(
      'button[title="Flushed on close"]',
    ) as HTMLButtonElement;
    expect(notePin).not.toBeNull();
    fireEvent.click(notePin, { clientX: 200, clientY: 220 });

    const reopenedTextarea = screen.getByPlaceholderText("Write a note");
    fireEvent.change(reopenedTextarea, {
      target: { value: "Should never commit after delete" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    expect(
      useAnnotationStore.getState().annotations.filter(isNoteAnnotation),
    ).toHaveLength(0);

    // Advance well past 300ms to prove pending debounced callback was canceled
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(
      useAnnotationStore.getState().annotations.filter(isNoteAnnotation),
    ).toHaveLength(0);
  });

  it("deletes markups, ink, and notes via eraser pointerDown & drag pointerEnter while disabling .textLayer selection", async () => {
    const { page1, page2 } = await mountTwoPageViewer();

    act(() => {
      const store = useAnnotationStore.getState();
      store.addAnnotation({
        id: "erase-hl",
        pageNumber: 1,
        toolType: "highlight",
        color: "#EAB308",
        text: "Erase me",
        rectSegments: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
        x: 0.1,
        y: 0.2,
        createdAt: "2026-01-01T00:00:00Z",
      });
      store.addAnnotation({
        id: "erase-ink",
        pageNumber: 1,
        toolType: "freehand_write",
        color: "#4F46E5",
        strokeWidth: 3,
        points: [
          { x: 0.1, y: 0.4 },
          { x: 0.4, y: 0.45 },
        ],
        x: 0.1,
        y: 0.4,
        createdAt: "2026-01-01T00:00:00Z",
      });
      store.addAnnotation({
        id: "erase-note",
        pageNumber: 2,
        toolType: "popup_note",
        color: "#0284C7",
        comment: "Delete via drag",
        x: 0.3,
        y: 0.5,
        createdAt: "2026-01-01T00:00:00Z",
      });
    });

    // Activate Eraser
    act(() => {
      useToolStore.getState().togglePreset("utility-eraser");
    });
    expect(useToolStore.getState().activeState.toolType).toBe("eraser");

    // Verify .textLayer selection & pointer-events are disabled on the page wrapper
    expect(page1.className).toContain("select-none");
    expect(page1.className).toContain("[&_.textLayer]:!pointer-events-none");
    expect(page1.className).toContain("[&_.textLayer]:!select-none");

    // 1. Erase highlight via pointerDown (button === 0)
    const hlSegment = page1.querySelector(
      'div[style*="left: 10%"][style*="top: 20%"]',
    ) as HTMLElement;
    expect(hlSegment).not.toBeNull();
    fireEvent.pointerDown(hlSegment, { button: 0 });
    expect(
      useAnnotationStore.getState().annotations.some((a) => a.id === "erase-hl"),
    ).toBe(false);

    // 2. Erase ink via drag-sweep pointerEnter (buttons === 1)
    const inkGroup = page1.querySelector("svg g") as SVGGElement;
    expect(inkGroup).not.toBeNull();
    fireEvent.pointerEnter(inkGroup, { buttons: 1 });
    expect(
      useAnnotationStore
        .getState()
        .annotations.some((a) => a.id === "erase-ink"),
    ).toBe(false);

    // 3. Erase note on Page 2 via drag-sweep pointerEnter (buttons === 1)
    const noteBtn = page2.querySelector(
      'button[title="Delete via drag"]',
    ) as HTMLButtonElement;
    expect(noteBtn).not.toBeNull();
    fireEvent.pointerEnter(noteBtn, { buttons: 1 });
    expect(useAnnotationStore.getState().annotations).toHaveLength(0);
  });

  it("reverts and reapplies edits using keyboard shortcuts Undo ($mod+z) and Redo ($mod+Shift+z, $mod+y)", async () => {
    await mountTwoPageViewer();

    // Wait for async loadForDocument() to finish clearing initial temporal history
    await waitFor(() => {
      expect(useAnnotationStore.getState().docId).toBe(TWO_PAGE_DOC.id);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      useAnnotationStore.getState().addAnnotation({
        id: "hist-1",
        pageNumber: 1,
        toolType: "popup_note",
        color: "#0284C7",
        comment: "First",
        x: 0.1,
        y: 0.1,
        createdAt: "2026-01-01T00:00:00Z",
      });
    });

    act(() => {
      useAnnotationStore.getState().addAnnotation({
        id: "hist-2",
        pageNumber: 2,
        toolType: "popup_note",
        color: "#0284C7",
        comment: "Second",
        x: 0.2,
        y: 0.2,
        createdAt: "2026-01-01T00:00:01Z",
      });
    });

    expect(useAnnotationStore.getState().annotations).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Undo" })).not.toBeDisabled();

    // Undo via Ctrl+z (Windows $mod)
    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual([
      "hist-1",
    ]);

    // Redo via Ctrl+Shift+z
    fireEvent.keyDown(window, {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual([
      "hist-1",
      "hist-2",
    ]);

    // Undo again, then Redo via Ctrl+y
    fireEvent.keyDown(window, { key: "z", code: "KeyZ", ctrlKey: true });
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual([
      "hist-1",
    ]);

    fireEvent.keyDown(window, { key: "y", code: "KeyY", ctrlKey: true });
    expect(useAnnotationStore.getState().annotations.map((a) => a.id)).toEqual([
      "hist-1",
      "hist-2",
    ]);
  });
});
