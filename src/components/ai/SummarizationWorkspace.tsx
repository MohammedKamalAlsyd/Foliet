/**
 * Foliet - Split-Screen Living Summary Workspace
 *
 * Renders inside ViewerView's right ResizablePanel alongside the live PDF viewer:
 * - Minimal header: doc title, chapter selector & jump menu, save status,
 *   Copy, Export .md, Export .docx, Close split
 * - Central Tiptap Markdown editor with `[Page X]` citation spotlighting & figure drop
 * - Compact bottom dock: system-prompt style presets, context toggles
 *   (Include Notes, Include Chats, Web Search), and conversational modification / generation
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import {
  BookOpen,
  Check,
  Copy,
  Download,
  FileText,
  Globe,
  ListTree,
  MessageSquare,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  StickyNote,
  X,
} from "lucide-react";
import { AiMascot, type MascotState } from "@/components/ai/AiMascot";
import {
  SummaryDocsEditor,
  clearResolvedCropCache,
  resolveMarkdownCropImages,
  type SummaryDocsEditorHandle,
} from "@/components/ai/SummaryDocsEditor";
import { Button } from "@/components/ui/button";
import { exportSummaryToDocx } from "@/services/docxExport";
import type { SummaryFocusMode } from "@/services/llm";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSummaryStore } from "@/stores/summaryStore";
import { isCropAnnotation, type PdfAnnotation } from "@/types/annotations";
import { resolveCropUri } from "@/utils/llmFormatting";
import { cn } from "@/lib/utils";

interface SummarizationWorkspaceProps {
  annotations?: PdfAnnotation[];
  onJumpToPage?: (page: number) => void;
}

const STYLE_PRESETS: Array<{ value: SummaryFocusMode; label: string }> = [
  { value: "study", label: "Study Notes" },
  { value: "executive", label: "Executive Brief" },
  { value: "technical", label: "Technical & Code" },
];

export const SummarizationWorkspace: React.FC<SummarizationWorkspaceProps> = ({
  annotations: liveAnnotations,
  onJumpToPage,
}) => {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const llmProvider = useAiConfigStore((s) => s.llmProvider);

  const {
    isSummaryWorkspaceOpen,
    setSummaryWorkspaceOpen,
    summaryFocusMode,
    setSummaryFocusMode,
    activeSummary,
    previousSummary,
    isLoadingSummary,
    isSummarizing,
    chapters,
    selectedChapterId,
    setSelectedChapterId,
    generationProgress,
    updateActiveSummaryLocal,
    loadSummary,
    restorePreviousSummary,
    generateChapterSummary,
    generateFullBookSummary,
    modifySummaryWithInstruction,
    cancelSummaryStreaming,
  } = useSummaryStore(
    useShallow((s) => ({
      isSummaryWorkspaceOpen: s.isSummaryWorkspaceOpen,
      setSummaryWorkspaceOpen: s.setSummaryWorkspaceOpen,
      summaryFocusMode: s.summaryFocusMode,
      setSummaryFocusMode: s.setSummaryFocusMode,
      activeSummary: s.activeSummary,
      previousSummary: s.previousSummary,
      isLoadingSummary: s.isLoadingSummary,
      isSummarizing: s.isSummarizing,
      chapters: s.chapters,
      selectedChapterId: s.selectedChapterId,
      setSelectedChapterId: s.setSelectedChapterId,
      generationProgress: s.generationProgress,
      updateActiveSummaryLocal: s.updateActiveSummaryLocal,
      loadSummary: s.loadSummary,
      restorePreviousSummary: s.restorePreviousSummary,
      generateChapterSummary: s.generateChapterSummary,
      generateFullBookSummary: s.generateFullBookSummary,
      modifySummaryWithInstruction: s.modifySummaryWithInstruction,
      cancelSummaryStreaming: s.cancelSummaryStreaming,
    })),
  );

  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeChats, setIncludeChats] = useState(false);
  const [summaryWebSearch, setSummaryWebSearch] = useState(false);

  const { conversations, loadConversations } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      loadConversations: s.loadConversations,
    })),
  );

  const editorRef = useRef<SummaryDocsEditorHandle | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveMarkdownRef = useRef<string | null>(null);
  const jumpMenuRef = useRef<HTMLDivElement | null>(null);
  const prevCropKeysRef = useRef<{
    docId?: string;
    crops: Map<string, string[]>;
  }>({ docId: undefined, crops: new Map() });

  const [fallbackAnnotations, setFallbackAnnotations] = useState<
    PdfAnnotation[]
  >([]);
  const [draftMarkdown, setDraftMarkdown] = useState(
    () => activeSummary?.content ?? "",
  );
  const [instruction, setInstruction] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const [isCopied, setIsCopied] = useState(false);
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false);

  const docId = activeDoc?.id;
  const docTitle = activeDoc?.title || "Untitled Document";
  const sourceAnnotations = liveAnnotations ?? fallbackAnnotations;

  const sourceSnapshotRef = useRef(activeSummary?.sourceSnapshot);
  sourceSnapshotRef.current = activeSummary?.sourceSnapshot;

  const selectedChapter = useMemo(
    () => chapters.find((c) => c.id === selectedChapterId),
    [chapters, selectedChapterId],
  );

  // Load summary, conversations, and fallback annotations when workspace opens
  useEffect(() => {
    if (!isSummaryWorkspaceOpen || !docId) return;
    pendingSaveMarkdownRef.current = null;
    loadSummary(docId);
    loadConversations(docId);
    if (!liveAnnotations) {
      DocumentDatabase.getAnnotations(docId)
        .then(setFallbackAnnotations)
        .catch(() => setFallbackAnnotations([]));
    }
  }, [
    isSummaryWorkspaceOpen,
    docId,
    liveAnnotations,
    loadSummary,
    loadConversations,
  ]);

  // Evict deleted crops from the resolved figure cache
  useEffect(() => {
    if (!liveAnnotations) return;
    const nextCrops = new Map<string, string[]>();
    for (const a of liveAnnotations) {
      if (isCropAnnotation(a)) {
        nextCrops.set(a.id, [
          a.id,
          a.imageUrl,
          resolveCropUri(a.id, a.imageUrl),
        ]);
      }
    }

    if (prevCropKeysRef.current.docId === docId) {
      for (const [prevId, keys] of prevCropKeysRef.current.crops) {
        if (!nextCrops.has(prevId)) {
          for (const key of keys) {
            if (key) clearResolvedCropCache(key);
          }
        }
      }
    }

    prevCropKeysRef.current = { docId, crops: nextCrops };
  }, [docId, liveAnnotations]);

  // Clear resolved figure cache on document change or workspace unmount
  useEffect(() => {
    return () => {
      clearResolvedCropCache();
    };
  }, [docId]);

  // Sync store content into editor draft once loaded
  useEffect(() => {
    if (isLoadingSummary) return;
    setDraftMarkdown(activeSummary?.content ?? "");
  }, [activeSummary?.content, isLoadingSummary]);

  // Close chapter jump popover on outside click
  useEffect(() => {
    if (!jumpMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        jumpMenuRef.current &&
        !jumpMenuRef.current.contains(e.target as Node)
      ) {
        setJumpMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [jumpMenuOpen]);

  // Debounced auto-save to SQLite
  const flushAutoSave = useCallback(
    async (markdownToSave: string) => {
      if (!docId) return;
      setSaveStatus("saving");
      try {
        await DocumentDatabase.saveSummary(
          docId,
          markdownToSave,
          sourceSnapshotRef.current,
        );
        pendingSaveMarkdownRef.current = null;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("idle");
      }
    },
    [docId],
  );

  const handleEditorMarkdownChange = useCallback(
    (nextMd: string) => {
      if (isLoadingSummary) return;
      setDraftMarkdown(nextMd);
      updateActiveSummaryLocal(nextMd);
      pendingSaveMarkdownRef.current = nextMd;
      setSaveStatus("saving");

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
        autoSaveTimerRef.current = null;
        flushAutoSave(nextMd);
      }, 700);
    },
    [flushAutoSave, isLoadingSummary, updateActiveSummaryLocal],
  );

  // Listen for 1-click "Insert in Summary" events from PdfPage / `add_figure_to_summary`
  useEffect(() => {
    const onInsertImage = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          docId?: string;
          src?: string;
          alt?: string;
        }>
      ).detail;
      if (!detail?.src) return;
      if (detail.docId && docId && detail.docId !== docId) return;
      if (!editorRef.current) return;

      e.preventDefault();
      editorRef.current.insertImage({
        src: detail.src,
        alt: detail.alt || "Captured PDF figure",
      });
    };
    window.addEventListener("foliet:insert-summary-image", onInsertImage);
    return () => {
      window.removeEventListener("foliet:insert-summary-image", onInsertImage);
    };
  }, [docId]);

  // Flush pending edits only on unmount or docId change
  useEffect(() => {
    const currentDocId = docId;
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      if (pendingSaveMarkdownRef.current !== null && currentDocId) {
        const toFlush = pendingSaveMarkdownRef.current;
        pendingSaveMarkdownRef.current = null;
        DocumentDatabase.saveSummary(
          currentDocId,
          toFlush,
          sourceSnapshotRef.current,
        ).catch(() => {});
      }
    };
  }, [docId]);

  const handleClose = useCallback(async () => {
    if (isSummarizing) {
      cancelSummaryStreaming();
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (pendingSaveMarkdownRef.current !== null) {
      await flushAutoSave(pendingSaveMarkdownRef.current);
    }
    if (docId) {
      await loadSummary(docId);
    }
    setSummaryWorkspaceOpen(false);
  }, [
    isSummarizing,
    cancelSummaryStreaming,
    flushAutoSave,
    docId,
    loadSummary,
    setSummaryWorkspaceOpen,
  ]);

  // Jump PDF without closing the split pane
  const handleJumpToPage = useCallback(
    (pageNumber: number) => {
      onJumpToPage?.(pageNumber);
    },
    [onJumpToPage],
  );

  const handleJumpToChapter = useCallback(
    (chapterId: string) => {
      const ch = chapters.find((c) => c.id === chapterId);
      if (!ch) return;
      setSelectedChapterId(ch.id);
      setJumpMenuOpen(false);
      onJumpToPage?.(ch.startPage);
      editorRef.current?.scrollToHeading(ch.title);
    },
    [chapters, setSelectedChapterId, onJumpToPage],
  );

  const handleGenerate = async (mode: "auto" | "full-book" = "auto") => {
    if (!docId) return;
    if (chapters.length === 0) {
      toast.error("Document pages are still loading");
      return;
    }

    const contextFlags = {
      includeNotes,
      includeChats,
      webSearchEnabled: llmProvider === "openrouter" && summaryWebSearch,
    };

    try {
      if (mode === "full-book" || selectedChapterId === "all") {
        await generateFullBookSummary(docId, {
          docTitle,
          chapters,
          annotations: sourceAnnotations,
          conversations,
          ...contextFlags,
        });
      } else if (selectedChapter) {
        await generateChapterSummary(docId, {
          docTitle,
          chapter: selectedChapter,
          annotations: sourceAnnotations,
          conversations,
          ...contextFlags,
        });
      }
      pendingSaveMarkdownRef.current = null;
      setSaveStatus("saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate summary");
    }
  };

  const handleSubmitInstruction = async () => {
    if (!docId) return;
    const trimmed = instruction.trim();
    if (!trimmed) {
      await handleGenerate("auto");
      return;
    }

    const currentMd = editorRef.current?.getMarkdown() ?? draftMarkdown;
    setInstruction("");
    try {
      await modifySummaryWithInstruction(docId, {
        docTitle,
        instruction: trimmed,
        existingMarkdown: currentMd,
        activeChapter: selectedChapter,
        annotations: sourceAnnotations,
        conversations,
        jumpToPage: onJumpToPage,
        includeNotes,
        includeChats,
        webSearchEnabled: llmProvider === "openrouter" && summaryWebSearch,
      });
      pendingSaveMarkdownRef.current = null;
      setSaveStatus("saved");
    } catch (err: any) {
      setInstruction(trimmed);
      toast.error(err?.message || "Failed to apply summary instruction");
    }
  };

  const handleRestorePrevious = async () => {
    if (!docId || isSummarizing) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    pendingSaveMarkdownRef.current = null;
    await restorePreviousSummary(docId);
    setSaveStatus("saved");
    toast.success("Restored previous summary");
  };

  const handleCopyMarkdown = async () => {
    const md = editorRef.current?.getMarkdown() ?? draftMarkdown;
    if (!md.trim()) {
      toast.error("Nothing to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(md);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1800);
    } catch {
      toast.error("Failed to copy Markdown");
    }
  };

  const handleExportMarkdown = async () => {
    const rawMd = editorRef.current?.getMarkdown() ?? draftMarkdown;
    if (!rawMd.trim()) {
      toast.error("Nothing to export yet");
      return;
    }

    const safeName = docTitle
      .replace(/\.pdf$/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    try {
      const targetPath = await save({
        defaultPath: `${safeName || "summary"}-notes.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!targetPath) return;

      const exportContent = await resolveMarkdownCropImages(rawMd);
      await writeFile(targetPath, new TextEncoder().encode(exportContent));
      toast.success("Exported Markdown");
    } catch (err: any) {
      console.error("Failed to export Markdown", err);
      toast.error(err?.message || "Failed to export Markdown");
    }
  };

  const handleExportDocx = async () => {
    const rawMd = editorRef.current?.getMarkdown() ?? draftMarkdown;
    if (!rawMd.trim()) {
      toast.error("Nothing to export yet");
      return;
    }
    try {
      const exported = await exportSummaryToDocx(rawMd, docTitle);
      if (exported) {
        toast.success("Exported Word document (.docx)");
      }
    } catch (err: any) {
      console.error("Failed to export .docx", err);
      toast.error(err?.message || "Failed to export .docx");
    }
  };

  if (!isSummaryWorkspaceOpen || !activeDoc) return null;

  const mascotState: MascotState = isSummarizing
    ? draftMarkdown.length > 0
      ? "speaking"
      : "thinking"
    : "idle";

  const statusLabel = isSummarizing
    ? generationProgress
      ? `Ch. ${generationProgress.current}/${generationProgress.total}`
      : "Writing"
    : saveStatus === "saving"
      ? "Saving"
      : saveStatus === "saved" || activeSummary
        ? "Saved"
        : "Draft";

  const isOpenRouter = llmProvider === "openrouter";
  const canRestorePrevious = Boolean(
    !isSummarizing &&
    previousSummary?.content?.trim() &&
    previousSummary.content !== draftMarkdown,
  );

  return (
    <aside
      aria-label="Living Summary Split Pane"
      className="flex h-full w-full flex-col bg-card"
    >
      {/* Top Header: Title, Chapter Selector + Jump, Status, Exports, Close Split */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted/30 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <AiMascot size={18} state={mascotState} className="shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-xs font-medium text-foreground max-w-[140px]">
                {docTitle}
              </h2>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {statusLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {canRestorePrevious && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title="Restore previous summary snapshot"
              onClick={handleRestorePrevious}
              className="h-7 gap-1 rounded-md px-2 text-[11px] text-amber-600 dark:text-amber-400 hover:bg-muted"
            >
              <RotateCcw size={12} strokeWidth={1.5} />
              <span>Restore</span>
            </Button>
          )}

          {/* Chapter Selector */}
          <select
            aria-label="Target chapter"
            value={selectedChapterId}
            disabled={isSummarizing}
            onChange={(e) => setSelectedChapterId(e.target.value)}
            className="h-7 max-w-[130px] truncate rounded-md border border-border bg-background px-2 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand)]"
          >
            <option value="all">Full Book ({chapters.length})</option>
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.title} (p.{ch.startPage}–{ch.endPage})
              </option>
            ))}
          </select>

          {/* Lightweight Chapter Jump Menu */}
          <div ref={jumpMenuRef} className="relative">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title="Jump to chapter in PDF & Summary"
              aria-label="Jump to chapter"
              onClick={() => setJumpMenuOpen((o) => !o)}
              className={cn(
                "h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                jumpMenuOpen && "bg-muted text-foreground",
              )}
            >
              <ListTree size={14} strokeWidth={1.5} />
            </Button>

            {jumpMenuOpen && (
              <div className="absolute right-0 top-8 z-50 w-64 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg">
                <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Jump to chapter
                </div>
                {chapters.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    No chapters detected
                  </div>
                ) : (
                  chapters.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => handleJumpToChapter(ch.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                        selectedChapterId === ch.id &&
                          "bg-accent font-medium text-foreground",
                      )}
                    >
                      <span className="truncate">{ch.title}</span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                        p.{ch.startPage}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Copy Markdown"
            aria-label="Copy Markdown"
            onClick={handleCopyMarkdown}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {isCopied ? (
              <Check
                size={14}
                strokeWidth={1.5}
                className="text-[var(--semantic-positive)]"
              />
            ) : (
              <Copy size={14} strokeWidth={1.5} />
            )}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="Export Markdown (.md)"
            onClick={handleExportMarkdown}
            className="h-7 gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Download size={12} strokeWidth={1.5} />
            <span>.md</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            title="Export Word Document (.docx)"
            onClick={handleExportDocx}
            className="h-7 gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FileText size={12} strokeWidth={1.5} />
            <span>.docx</span>
          </Button>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            title="Close split summary"
            aria-label="Close split summary"
            onClick={handleClose}
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={15} strokeWidth={1.5} />
          </Button>
        </div>
      </header>

      {/* Central Living Markdown Editor */}
      <main className="min-h-0 flex-1 overflow-hidden">
        <SummaryDocsEditor
          ref={editorRef}
          markdown={draftMarkdown}
          isStreaming={isSummarizing}
          onMarkdownChange={handleEditorMarkdownChange}
          onJumpToPage={handleJumpToPage}
        />
      </main>

      {/* Compact Bottom Control Dock */}
      <footer className="shrink-0 border-t border-border bg-card px-3 py-2.5 space-y-2">
        {/* Row 1: System-Prompt Style Presets & Context Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {/* Style Mode Presets */}
          <div
            role="group"
            aria-label="Summary style preset"
            className="inline-flex items-center rounded-lg border border-border bg-muted/60 p-0.5"
          >
            {STYLE_PRESETS.map((preset) => {
              const active = summaryFocusMode === preset.value;
              return (
                <button
                  key={preset.value}
                  type="button"
                  disabled={isSummarizing}
                  onClick={() => setSummaryFocusMode(preset.value)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          {/* Context Toggles */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={isSummarizing}
              onClick={() => setIncludeNotes(!includeNotes)}
              title="Automatically include sticky notes & highlights in chapter range"
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                includeNotes
                  ? "border-[var(--accent-brand,#2563EB)]/40 bg-[var(--accent-brand,#2563EB)]/10 text-[var(--accent-brand,#2563EB)] font-medium"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <StickyNote size={11} strokeWidth={1.6} />
              <span>Notes</span>
            </button>

            <button
              type="button"
              disabled={isSummarizing}
              onClick={() => setIncludeChats(!includeChats)}
              title="Include saved Lio chat takeaways"
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                includeChats
                  ? "border-[var(--accent-brand,#2563EB)]/40 bg-[var(--accent-brand,#2563EB)]/10 text-[var(--accent-brand,#2563EB)] font-medium"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <MessageSquare size={11} strokeWidth={1.6} />
              <span>Chats</span>
            </button>

            <button
              type="button"
              disabled={isSummarizing || !isOpenRouter}
              onClick={() => setSummaryWebSearch(!summaryWebSearch)}
              title={
                isOpenRouter
                  ? "Enable OpenRouter live Web Search"
                  : "Web Search requires OpenRouter provider"
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                !isOpenRouter && "opacity-45 cursor-not-allowed",
                isOpenRouter && summaryWebSearch
                  ? "border-[var(--accent-brand,#2563EB)]/40 bg-[var(--accent-brand,#2563EB)]/10 text-[var(--accent-brand,#2563EB)] font-medium"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <Globe size={11} strokeWidth={1.6} />
              <span>Web</span>
            </button>
          </div>
        </div>

        {/* Row 2: Conversational Modification Composer + Generate / Stop */}
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={instruction}
            disabled={isSummarizing}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (instruction.trim()) {
                  void handleSubmitInstruction();
                }
              }
            }}
            placeholder={
              draftMarkdown.trim()
                ? "Refine summary (e.g. 'Expand section 2 with equations on page 14')…"
                : "Optional instruction, or click Generate to synthesize…"
            }
            className="min-h-[38px] max-h-24 flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand)]"
          />

          <div className="flex shrink-0 items-center gap-1.5">
            {isSummarizing ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={cancelSummaryStreaming}
                className="h-9 gap-1.5 rounded-lg px-3 text-xs"
              >
                <Square size={12} fill="currentColor" />
                <span>Stop</span>
              </Button>
            ) : instruction.trim() ? (
              <Button
                type="button"
                size="sm"
                onClick={handleSubmitInstruction}
                className="h-9 gap-1.5 rounded-lg bg-[var(--accent-brand)] px-3 text-xs text-[var(--accent-brand-fg)] hover:opacity-90"
              >
                <Send size={13} strokeWidth={1.6} />
                <span>Apply</span>
              </Button>
            ) : (
              <>
                {selectedChapterId !== "all" && chapters.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleGenerate("full-book")}
                    title="Generate all chapters sequentially"
                    className="h-9 gap-1 rounded-lg px-2.5 text-xs"
                  >
                    <BookOpen size={13} strokeWidth={1.5} />
                    <span>Full Book</span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleGenerate("auto")}
                  className="h-9 gap-1.5 rounded-lg bg-[var(--accent-brand)] px-3 text-xs text-[var(--accent-brand-fg)] hover:opacity-90"
                >
                  <Sparkles size={13} strokeWidth={1.6} />
                  <span>
                    {selectedChapterId === "all"
                      ? "Generate Full Book"
                      : "Generate Chapter"}
                  </span>
                </Button>
              </>
            )}
          </div>
        </div>
      </footer>
    </aside>
  );
};
