import { describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { useAnnotationStore } from "@/stores/annotationStore";
import { useDocumentStore } from "@/stores/documentStore";
import { mockWindowClose, triggerCloseRequested } from "@/test/fakes/mockTauri";
import type { DocumentItem } from "@/types/document";

const TEST_DOC: DocumentItem = {
  id: "doc-guard-1",
  title: "Neural Retrieval Paper",
  pages: 2,
  filePath: "/mock/sample-2page.pdf",
  lastPage: 1,
  zoom: 100,
};

function makeDirty() {
  act(() => {
    useAnnotationStore.getState().addAnnotation({
      id: "annot-dirty-1",
      pageNumber: 1,
      toolType: "popup_note",
      color: "#0284C7",
      comment: "Unsaved note",
      x: 0.2,
      y: 0.3,
      createdAt: "2026-01-01T00:00:00Z",
    });
  });
}

describe("App close guard & unsaved annotations workflow", () => {
  it("leaves Home and closes window immediately without ConfirmModal when document is clean", async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().openDocument(TEST_DOC);

    render(<App />);

    // Viewer is active and clean
    expect(useDocumentStore.getState().isDirty).toBe(false);
    expect(screen.getByRole("button", { name: /library/i })).toBeInTheDocument();

    // Clicking Home (Library) returns directly to LibraryView without ConfirmModal
    await user.click(screen.getByRole("button", { name: /library/i }));
    expect(screen.queryByText("Unsaved annotations")).not.toBeInTheDocument();
    expect(useDocumentStore.getState().activeDoc).toBeNull();
    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();

    // Re-open clean document and click Close window button
    act(() => {
      useDocumentStore.getState().openDocument(TEST_DOC);
    });
    await user.click(screen.getByRole("button", { name: "Close window" }));
    expect(screen.queryByText("Unsaved annotations")).not.toBeInTheDocument();
    expect(mockWindowClose).toHaveBeenCalledTimes(1);

    // OS close request while clean must NOT call preventDefault
    const { prevented } = triggerCloseRequested();
    expect(prevented).toBe(false);
    expect(screen.queryByText("Unsaved annotations")).not.toBeInTheDocument();
  });

  it("guards Home navigation with ConfirmModal when dirty: Cancel keeps doc open, Discard edits closes to LibraryView", async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().openDocument(TEST_DOC);

    render(<App />);
    await waitFor(() => {
      expect(useAnnotationStore.getState().docId).toBe(TEST_DOC.id);
    });

    makeDirty();
    expect(useDocumentStore.getState().isDirty).toBe(true);

    // Request Home -> ConfirmModal opens
    await user.click(screen.getByRole("button", { name: /library/i }));
    expect(await screen.findByText("Unsaved annotations")).toBeInTheDocument();
    expect(
      screen.getByText(/You have unsaved edits in this document/i),
    ).toBeInTheDocument();

    // Cancel keeps document open
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Unsaved annotations")).not.toBeInTheDocument();
    });
    expect(useDocumentStore.getState().activeDoc?.id).toBe(TEST_DOC.id);

    // Request Home again and confirm "Discard edits"
    await user.click(screen.getByRole("button", { name: /library/i }));
    expect(await screen.findByText("Unsaved annotations")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard edits" }));

    await waitFor(() => {
      expect(useDocumentStore.getState().activeDoc).toBeNull();
    });
    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
  });

  it("intercepts OS WindowService.onCloseRequested when dirty, resets forceClosingRef on close rejection, and avoids infinite loop on confirm", async () => {
    const user = userEvent.setup();
    useDocumentStore.getState().openDocument(TEST_DOC);

    render(<App />);
    await waitFor(() => {
      expect(useAnnotationStore.getState().docId).toBe(TEST_DOC.id);
    });

    makeDirty();
    expect(useDocumentStore.getState().isDirty).toBe(true);

    // 1. OS close requested while dirty -> preventDefault() + ConfirmModal opens
    let firstAttempt!: ReturnType<typeof triggerCloseRequested>;
    act(() => {
      firstAttempt = triggerCloseRequested();
    });
    expect(firstAttempt.event.preventDefault).toHaveBeenCalledTimes(1);
    expect(firstAttempt.prevented).toBe(true);
    expect(await screen.findByText("Unsaved annotations")).toBeInTheDocument();

    // 2. If WindowService.close() rejects, forceClosingRef must reset so future close requests are still guarded
    mockWindowClose.mockRejectedValueOnce(new Error("OS close denied"));
    await user.click(screen.getByRole("button", { name: "Discard edits" }));
    await waitFor(() => {
      expect(mockWindowClose).toHaveBeenCalledTimes(1);
    });

    // Wait a tick for the catch handler to reset forceClosingRef
    await waitFor(() => {
      expect(screen.queryByText("Unsaved annotations")).not.toBeInTheDocument();
    });

    let retryAttempt!: ReturnType<typeof triggerCloseRequested>;
    act(() => {
      retryAttempt = triggerCloseRequested();
    });
    expect(retryAttempt.prevented).toBe(true);
    expect(await screen.findByText("Unsaved annotations")).toBeInTheDocument();

    // 3. Confirming when WindowService.close() succeeds triggers a re-entrant OS close event
    //    which must NOT call preventDefault or reopen the modal (no infinite loop).
    let reentrantPrevented = true;
    mockWindowClose.mockImplementationOnce(async () => {
      const reentrant = triggerCloseRequested();
      reentrantPrevented = reentrant.prevented;
    });

    await user.click(screen.getByRole("button", { name: "Discard edits" }));

    await waitFor(() => {
      expect(mockWindowClose).toHaveBeenCalledTimes(2);
    });
    expect(reentrantPrevented).toBe(false);
    expect(screen.queryByText("Unsaved annotations")).not.toBeInTheDocument();
  });
});
