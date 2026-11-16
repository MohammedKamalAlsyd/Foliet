/**
 * Foliet - Split-Screen AI Summarization Workspace
 *
 * Pairs user-curated PDF highlights, underlines, sticky notes, figure crops,
 * and saved Lio chat takeaways (left pane) with a live Markdown-backed
 * Tiptap Docs editor (right pane) that auto-saves to SQLite.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import {
    Check,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    ImagePlus,
    MessageSquare,
    RefreshCw,
    Square,
    X,
} from "lucide-react";
import { AiMascot, type MascotState } from "@/components/ai/AiMascot";
import {
    SummaryDocsEditor,
    resolveCropImageSrc,
    resolveMarkdownCropImages,
    type SummaryDocsEditorHandle,
} from "@/components/ai/SummaryDocsEditor";
import { Button } from "@/components/ui/button";
import type { SummaryFocusMode } from "@/services/llm";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useAiStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";
import {
    isCropAnnotation,
    isNoteAnnotation,
    isTextMarkupAnnotation,
    type CropAnnotation,
    type NoteAnnotation,
    type PdfAnnotation,
    type TextMarkupAnnotation,
} from "@/types/annotations";
import { cn } from "@/lib/utils";

interface SummarizationWorkspaceProps {
    annotations?: PdfAnnotation[];
}

const FOCUS_OPTIONS: Array<{ value: SummaryFocusMode; label: string }> = [
    { value: "executive", label: "Executive Brief" },
    { value: "study", label: "Study Notes" },
    { value: "technical", label: "Technical & Code" },
];

const CropThumbnail: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
    const [resolved, setResolved] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        resolveCropImageSrc(src)
            .then((url) => {
                if (active) setResolved(url);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [src]);

    if (!resolved) {
        return (
            <div className="flex h-20 w-full items-center justify-center rounded-md border border-border bg-muted text-[11px] text-muted-foreground">
                Loading figure
            </div>
        );
    }

    return (
        <img
            src={resolved}
            alt={alt}
            className="max-h-28 w-full rounded-md border border-border bg-white object-contain"
        />
    );
};

export const SummarizationWorkspace: React.FC<SummarizationWorkspaceProps> = ({
    annotations: liveAnnotations,
}) => {
    const activeDoc = useDocumentStore((s) => s.activeDoc);
    const theme = useSystemStore((s) => s.theme);

    const {
        isSummaryWorkspaceOpen,
        setSummaryWorkspaceOpen,
        summaryFocusMode,
        setSummaryFocusMode,
        activeSummary,
        isSummarizing,
        loadSummary,
        generateStructuredSummary,
        cancelSummaryStreaming,
        conversations,
        loadConversations,
    } = useAiStore();

    const editorRef = useRef<SummaryDocsEditorHandle | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSaveMarkdownRef = useRef<string | null>(null);

    const [fallbackAnnotations, setFallbackAnnotations] = useState<PdfAnnotation[]>([]);
    const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
    const [includedChatIds, setIncludedChatIds] = useState<Set<string>>(() => new Set());
    const [chatsExpanded, setChatsExpanded] = useState(false);

    const [draftMarkdown, setDraftMarkdown] = useState("");
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
    const [isCopied, setIsCopied] = useState(false);

    const docId = activeDoc?.id;
    const docTitle = activeDoc?.title || "Untitled Document";

    // Load summary, conversations, and fallback SQLite annotations when workspace opens
    useEffect(() => {
        if (!isSummaryWorkspaceOpen || !docId) return;

        loadSummary(docId);
        loadConversations(docId);

        if (!liveAnnotations) {
            DocumentDatabase.getAnnotations(docId)
                .then(setFallbackAnnotations)
                .catch(() => setFallbackAnnotations([]));
        }
    }, [isSummaryWorkspaceOpen, docId, liveAnnotations, loadSummary, loadConversations]);

    // Sync activeSummary from store into local editor draft
    useEffect(() => {
        setDraftMarkdown(activeSummary?.content ?? "");
    }, [activeSummary?.content]);

    const sourceAnnotations = liveAnnotations ?? fallbackAnnotations;

    // Group user markups, notes, and crops by page
    const { highlights, notes, crops, pages } = useMemo(() => {
        const hl: TextMarkupAnnotation[] = [];
        const nt: NoteAnnotation[] = [];
        const cr: CropAnnotation[] = [];
        const pageSet = new Set<number>();

        for (const a of sourceAnnotations) {
            if (isTextMarkupAnnotation(a) && a.text.trim()) {
                hl.push(a);
                pageSet.add(a.pageNumber);
            } else if (isNoteAnnotation(a) && a.comment.trim()) {
                nt.push(a);
                pageSet.add(a.pageNumber);
            } else if (isCropAnnotation(a)) {
                cr.push(a);
                pageSet.add(a.pageNumber);
            }
        }

        const sortedPages = Array.from(pageSet).sort((a, b) => a - b);
        return { highlights: hl, notes: nt, crops: cr, pages: sortedPages };
    }, [sourceAnnotations]);

    const nonEmptyConversations = useMemo(
        () => conversations.filter((c) => c.messages.length > 0),
        [conversations]
    );

    const toggleAnnotationIncluded = (id: string) => {
        setExcludedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleChatIncluded = (id: string) => {
        setIncludedChatIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Debounced auto-save to SQLite
    const flushAutoSave = useCallback(
        async (markdownToSave: string) => {
            if (!docId) return;
            setSaveStatus("saving");
            try {
                await DocumentDatabase.saveSummary(
                    docId,
                    markdownToSave,
                    activeSummary?.sourceSnapshot
                );
                pendingSaveMarkdownRef.current = null;
                setSaveStatus("saved");
            } catch {
                setSaveStatus("idle");
            }
        },
        [docId, activeSummary?.sourceSnapshot]
    );

    const handleEditorMarkdownChange = useCallback(
        (nextMd: string) => {
            setDraftMarkdown(nextMd);
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
        [flushAutoSave]
    );

    // Flush pending edits on unmount
    useEffect(() => {
        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
                autoSaveTimerRef.current = null;
            }
            if (pendingSaveMarkdownRef.current !== null && docId) {
                DocumentDatabase.saveSummary(
                    docId,
                    pendingSaveMarkdownRef.current,
                    activeSummary?.sourceSnapshot
                ).catch(() => {});
            }
        };
    }, [docId, activeSummary?.sourceSnapshot]);

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

    const handleGenerate = async () => {
        if (!docId) return;

        const selectedHighlights = highlights
            .filter((h) => !excludedIds.has(h.id))
            .map((h) => ({
                pageNumber: h.pageNumber,
                toolType: h.toolType,
                text: h.text,
            }));

        const selectedNotes = notes
            .filter((n) => !excludedIds.has(n.id))
            .map((n) => ({
                pageNumber: n.pageNumber,
                comment: n.comment,
                contextSnippet: n.contextSnippet,
            }));

        const selectedCrops = crops
            .filter((c) => !excludedIds.has(c.id))
            .map((c) => ({
                id: c.id,
                pageNumber: c.pageNumber,
                imageUrl: c.imageUrl.startsWith("idb://")
                    ? c.imageUrl
                    : `idb://${c.id}`,
                caption: c.caption,
            }));

        const selectedChats = nonEmptyConversations
            .filter((c) => includedChatIds.has(c.id))
            .map((c) => ({
                title: c.title,
                excerpts: c.messages
                    .filter((m) => m.content.trim().length > 0)
                    .slice(-6)
                    .map(
                        (m) =>
                            `${m.role === "user" ? "Question" : "Lio"}: ${m.content
                                .trim()
                                .slice(0, 600)}`
                    ),
            }));

        let fallbackExcerpt: string | undefined;
        if (
            selectedHighlights.length === 0 &&
            selectedNotes.length === 0 &&
            selectedCrops.length === 0 &&
            selectedChats.length === 0
        ) {
            const chunks = await RagService.getDocumentChunks(docId).catch(() => []);
            if (chunks.length > 0) {
                fallbackExcerpt = chunks
                    .slice(0, 8)
                    .map((ch) => `[Page ${ch.pageNumber}] ${ch.text}`)
                    .join("\n\n");
            } else {
                toast.error(
                    "Select at least one highlight, note, crop, or chat takeaway to generate"
                );
                return;
            }
        }

        try {
            await generateStructuredSummary(docId, {
                docTitle,
                focusMode: summaryFocusMode,
                highlights: selectedHighlights,
                notes: selectedNotes,
                crops: selectedCrops,
                chatTakeaways: selectedChats,
                fallbackExcerpt,
            });
            setSaveStatus("saved");
        } catch (err: any) {
            toast.error(err?.message || "Failed to generate summary");
        }
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
            await writeTextFile(targetPath, exportContent);
            toast.success("Exported Markdown");
        } catch (err: any) {
            toast.error(err?.message || "Failed to export Markdown");
        }
    };

    const mascotState: MascotState = isSummarizing
        ? draftMarkdown.length > 0
            ? "speaking"
            : "thinking"
        : "idle";

    if (!isSummaryWorkspaceOpen || !activeDoc) return null;

    const totalIncludedAnnotations =
        highlights.filter((h) => !excludedIds.has(h.id)).length +
        notes.filter((n) => !excludedIds.has(n.id)).length +
        crops.filter((c) => !excludedIds.has(c.id)).length;

    return (
        <div
            data-theme={theme}
            role="dialog"
            aria-modal="true"
            aria-label="Summarization Studio"
            className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
        >
            {/* Header Bar */}
            <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4">
                <div className="flex min-w-0 items-center gap-3">
                    <AiMascot size={20} state={mascotState} className="shrink-0" />
                    <div className="flex min-w-0 items-center gap-2">
                        <h2 className="truncate text-sm font-medium text-foreground">
                            {docTitle}
                        </h2>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            {isSummarizing
                                ? "Generating"
                                : saveStatus === "saving"
                                ? "Saving"
                                : saveStatus === "saved" || activeSummary
                                ? "Saved"
                                : "Draft"}
                        </span>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    {/* Summary Focus Mode Selector */}
                    <select
                        aria-label="Summary focus"
                        value={summaryFocusMode}
                        disabled={isSummarizing}
                        onChange={(e) =>
                            setSummaryFocusMode(e.target.value as SummaryFocusMode)
                        }
                        className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand)]"
                    >
                        {FOCUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>

                    {/* Generate / Regenerate or Stop */}
                    {isSummarizing ? (
                        <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={cancelSummaryStreaming}
                            className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                        >
                            <Square size={12} fill="currentColor" />
                            <span>Stop</span>
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleGenerate}
                            className="h-8 gap-1.5 rounded-lg bg-[var(--accent-brand)] px-3 text-xs text-[var(--accent-brand-fg)] hover:opacity-90"
                        >
                            <RefreshCw size={13} strokeWidth={1.5} />
                            <span>
                                {draftMarkdown.trim() ? "Regenerate" : "Generate"}
                            </span>
                        </Button>
                    )}

                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleCopyMarkdown}
                        className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                    >
                        {isCopied ? (
                            <>
                                <Check size={13} strokeWidth={1.5} />
                                <span>Copied</span>
                            </>
                        ) : (
                            <>
                                <Copy size={13} strokeWidth={1.5} />
                                <span>Copy Markdown</span>
                            </>
                        )}
                    </Button>

                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleExportMarkdown}
                        className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                    >
                        <Download size={13} strokeWidth={1.5} />
                        <span>Export .md</span>
                    </Button>

                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={handleClose}
                        aria-label="Close Summarization Studio"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <X size={16} strokeWidth={1.5} />
                    </Button>
                </div>
            </header>

            {/* Split-Screen Body */}
            <div className="flex min-h-0 flex-1 overflow-hidden">
                {/* Left Pane: User Highlights, Notes, Figure Crops & Chat Takeaways */}
                <aside className="flex w-[340px] shrink-0 flex-col border-r border-border bg-[var(--bg-deep)] lg:w-[380px]">
                    <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card/60 px-4">
                        <span className="text-xs font-medium text-foreground">
                            Source material
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {totalIncludedAnnotations} selected
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {pages.length === 0 ? (
                            <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
                                No highlights, sticky notes, or figure crops in this document yet. You can still generate from indexed chunks or include saved Lio chat takeaways below.
                            </div>
                        ) : (
                            pages.map((pageNum) => {
                                const pageHighlights = highlights.filter(
                                    (h) => h.pageNumber === pageNum
                                );
                                const pageNotes = notes.filter(
                                    (n) => n.pageNumber === pageNum
                                );
                                const pageCrops = crops.filter(
                                    (c) => c.pageNumber === pageNum
                                );

                                return (
                                    <section key={pageNum} className="space-y-2">
                                        <div className="flex items-center justify-between px-1">
                                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                                                Page {pageNum}
                                            </span>
                                            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                                {pageHighlights.length +
                                                    pageNotes.length +
                                                    pageCrops.length}
                                            </span>
                                        </div>

                                        {/* Text Highlights & Underlines */}
                                        {pageHighlights.map((item) => {
                                            const checked = !excludedIds.has(item.id);
                                            return (
                                                <label
                                                    key={item.id}
                                                    className={cn(
                                                        "flex cursor-pointer items-start gap-2 rounded-xl border bg-card p-3 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                                                        checked
                                                            ? "border-border"
                                                            : "border-border/50 opacity-55"
                                                    )}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() =>
                                                            toggleAnnotationIncluded(
                                                                item.id
                                                            )
                                                        }
                                                        className="mt-0.5 shrink-0 accent-[var(--accent-brand)]"
                                                    />
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                                            <span
                                                                className="h-2 w-2 shrink-0 rounded-full"
                                                                style={{
                                                                    backgroundColor:
                                                                        item.color,
                                                                }}
                                                            />
                                                            <span className="capitalize">
                                                                {item.toolType}
                                                            </span>
                                                        </div>
                                                        <p className="leading-relaxed text-foreground">
                                                            {item.text}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })}

                                        {/* Sticky Notes */}
                                        {pageNotes.map((note) => {
                                            const checked = !excludedIds.has(note.id);
                                            return (
                                                <label
                                                    key={note.id}
                                                    className={cn(
                                                        "flex cursor-pointer items-start gap-2 rounded-xl border bg-card p-3 text-xs transition-colors duration-150 ease-[var(--ease-foliet)]",
                                                        checked
                                                            ? "border-border"
                                                            : "border-border/50 opacity-55"
                                                    )}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() =>
                                                            toggleAnnotationIncluded(
                                                                note.id
                                                            )
                                                        }
                                                        className="mt-0.5 shrink-0 accent-[var(--accent-brand)]"
                                                    />
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                                            <span
                                                                className="h-2 w-2 shrink-0 rounded-full"
                                                                style={{
                                                                    backgroundColor:
                                                                        note.color,
                                                                }}
                                                            />
                                                            <span>Note</span>
                                                        </div>
                                                        <p className="leading-relaxed text-foreground">
                                                            {note.comment}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })}

                                        {/* Captured Figure Crops */}
                                        {pageCrops.map((crop) => {
                                            const checked = !excludedIds.has(crop.id);
                                            const cropLabel =
                                                crop.caption ||
                                                `Figure (Page ${crop.pageNumber})`;
                                            return (
                                                <div
                                                    key={crop.id}
                                                    className={cn(
                                                        "rounded-xl border bg-card p-3 space-y-2 transition-colors duration-150 ease-[var(--ease-foliet)]",
                                                        checked
                                                            ? "border-border"
                                                            : "border-border/50 opacity-55"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() =>
                                                                    toggleAnnotationIncluded(
                                                                        crop.id
                                                                    )
                                                                }
                                                                className="shrink-0 accent-[var(--accent-brand)]"
                                                            />
                                                            <span
                                                                className="h-2 w-2 shrink-0 rounded-full"
                                                                style={{
                                                                    backgroundColor:
                                                                        crop.color,
                                                                }}
                                                            />
                                                            <span>Figure crop</span>
                                                        </label>

                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="ghost"
                                                            disabled={isSummarizing}
                                                            onClick={() =>
                                                                editorRef.current?.insertImage(
                                                                    {
                                                                        src: crop.imageUrl,
                                                                        alt: cropLabel,
                                                                    }
                                                                )
                                                            }
                                                            className="h-6 gap-1 rounded-md px-2 text-[11px] text-foreground hover:bg-muted"
                                                        >
                                                            <ImagePlus
                                                                size={12}
                                                                strokeWidth={1.5}
                                                            />
                                                            <span>Insert</span>
                                                        </Button>
                                                    </div>

                                                    <CropThumbnail
                                                        src={crop.imageUrl}
                                                        alt={cropLabel}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </section>
                                );
                            })
                        )}

                        {/* Collapsible Saved Lio Chat Takeaways */}
                        <section className="rounded-xl border border-border bg-card">
                            <button
                                type="button"
                                onClick={() => setChatsExpanded((v) => !v)}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted/50 rounded-xl transition-colors duration-150"
                            >
                                <span className="flex items-center gap-2">
                                    {chatsExpanded ? (
                                        <ChevronDown size={14} strokeWidth={1.5} />
                                    ) : (
                                        <ChevronRight size={14} strokeWidth={1.5} />
                                    )}
                                    <MessageSquare size={14} strokeWidth={1.5} />
                                    <span>Saved Lio Chat Takeaways</span>
                                </span>
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                    {includedChatIds.size}/{nonEmptyConversations.length}
                                </span>
                            </button>

                            {chatsExpanded && (
                                <div className="border-t border-border p-3 space-y-2">
                                    {nonEmptyConversations.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">
                                            No saved Lio conversations for this paper.
                                        </p>
                                    ) : (
                                        nonEmptyConversations.map((conv) => {
                                            const checked = includedChatIds.has(
                                                conv.id
                                            );
                                            const lastAssistant = [...conv.messages]
                                                .reverse()
                                                .find((m) => m.role === "assistant");
                                            return (
                                                <label
                                                    key={conv.id}
                                                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-background p-2 text-xs"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() =>
                                                            toggleChatIncluded(conv.id)
                                                        }
                                                        className="mt-0.5 shrink-0 accent-[var(--accent-brand)]"
                                                    />
                                                    <div className="min-w-0 flex-1 space-y-1">
                                                        <div className="truncate font-medium text-foreground">
                                                            {conv.title}
                                                        </div>
                                                        {lastAssistant && (
                                                            <p className="line-clamp-2 text-[11px] text-muted-foreground">
                                                                {lastAssistant.content}
                                                            </p>
                                                        )}
                                                    </div>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </section>
                    </div>
                </aside>

                {/* Right Pane: Tiptap Docs Editor */}
                <main className="min-w-0 flex-1 overflow-hidden">
                    <SummaryDocsEditor
                        ref={editorRef}
                        markdown={draftMarkdown}
                        isStreaming={isSummarizing}
                        onMarkdownChange={handleEditorMarkdownChange}
                    />
                </main>
            </div>
        </div>
    );
};
