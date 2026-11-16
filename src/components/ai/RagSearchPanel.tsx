/**
 * Foliet - RAG Search & Indexing Panel
 *
 * Implements dense semantic retrieval across the active PDF or entire library,
 * document vector indexing controls, local embedding model status and downloads,
 * chunk inspection, and semantic search result navigation.
 */

import React, { useEffect, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    Database,
    Download,
    Eye,
    FileText,
    Loader2,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { useAiStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";
import type { RagSearchResult } from "@/types/embedding";
import { cn } from "@/lib/utils";

interface RagSearchPanelProps {
    onJumpToPage: (page: number) => void;
}

export const RagSearchPanel: React.FC<RagSearchPanelProps> = ({ onJumpToPage }) => {
    const activeDoc = useDocumentStore((s) => s.activeDoc);
    const openDocument = useDocumentStore((s) => s.openDocument);

    const {
        catalog,
        searchScope,
        setSearchScope,
        ragQuery,
        setRagQuery,
        ragResults,
        isSearchingRag,
        searchRag,
        activeRagHighlight,
        setActiveRagHighlight,
        hyperparameters,
        setHyperparameters,
        isIndexing,
        indexingProgress,
        indexingError,
        indexDocument,
        removeDocumentIndex,
        localModelStatus,
        isDownloadingModel,
        downloadProgress,
        downloadLocalModel,
        isInspectChunksMode,
        setInspectChunksMode,
        inspectedChunks,
        isLoadingChunks,
        inspectChunksForDocument,
        embeddingProvider,
        embeddingModel,
    } = useAiStore();

    const [searchInput, setSearchInput] = useState(ragQuery);
    const [selectedPageFilter, setSelectedPageFilter] = useState<number | "all">("all");

    // Check if active document is indexed in catalog or documentStore
    const catalogEntry = catalog.documents.find((d) => d.docId === activeDoc?.id);
    const isDocIndexed = Boolean(activeDoc?.isIndexed || catalogEntry);
    const chunkCount = catalogEntry?.chunkCount ?? (activeDoc?.isIndexed ? 6 : 0);

    // Sync input with store query
    useEffect(() => {
        setSearchInput(ragQuery);
    }, [ragQuery]);

    const handleExecuteSearch = (e?: React.FormEvent) => {
        e?.preventDefault();
        const q = searchInput.trim();
        setRagQuery(q);
        searchRag(q, activeDoc?.id);
    };

    const handleIndexDoc = async () => {
        if (!activeDoc) return;
        await indexDocument(
            activeDoc.id,
            activeDoc.title,
            activeDoc.filePath || `/documents/${activeDoc.id}.pdf`
        );
    };

    const handleRemoveIndex = async () => {
        if (!activeDoc) return;
        await removeDocumentIndex(activeDoc.id);
        if (isInspectChunksMode) {
            setInspectChunksMode(false);
        }
    };

    const handleToggleInspectChunks = async () => {
        if (!activeDoc) return;
        const next = !isInspectChunksMode;
        setInspectChunksMode(next);
        if (next) {
            await inspectChunksForDocument(activeDoc.id);
        }
    };

    const handleResultClick = (result: RagSearchResult) => {
        setActiveRagHighlight(result);

        if (activeDoc && result.docId === activeDoc.id) {
            onJumpToPage(result.pageNumber);
        } else {
            // Find document in catalog to open
            const targetCatalog = catalog.documents.find((d) => d.docId === result.docId);
            if (targetCatalog) {
                openDocument({
                    id: targetCatalog.docId,
                    title: targetCatalog.docTitle,
                    pages: 10,
                    filePath: targetCatalog.filePath,
                    isIndexed: true,
                    lastPage: result.pageNumber,
                });
                onJumpToPage(result.pageNumber);
            }
        }
    };

    const filteredChunks = inspectedChunks.filter((chunk) =>
        selectedPageFilter === "all" ? true : chunk.pageNumber === selectedPageFilter
    );

    const availablePages = Array.from(new Set(inspectedChunks.map((c) => c.pageNumber))).sort(
        (a, b) => a - b
    );

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background">
            {/* Top Sub-Bar: Scope Switcher & Hyperparameters */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/80 bg-muted/20 px-3">
                {/* Scope Segmented Control */}
                <div className="flex items-center rounded-lg border border-border/70 bg-muted/50 p-0.5 text-xs">
                    <button
                        type="button"
                        onClick={() => setSearchScope("current")}
                        className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            searchScope === "current"
                                ? "bg-card text-foreground shadow-sm font-medium"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        This PDF
                    </button>
                    <button
                        type="button"
                        onClick={() => setSearchScope("all")}
                        className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            searchScope === "all"
                                ? "bg-card text-foreground shadow-sm font-medium"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        All PDFs ({catalog.documents.length})
                    </button>
                </div>

                {/* Hyperparameters Config Popover */}
                <Popover>
                    <PopoverTrigger
                        render={
                            <button
                                type="button"
                                title="RAG Hyperparameters: Top-K & Similarity Threshold"
                                className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] font-mono text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                            >
                                <SlidersHorizontal size={12} />
                                <span>K={hyperparameters.topK} · {Math.round(hyperparameters.similarityThreshold * 100)}%</span>
                            </button>
                        }
                    />
                    <PopoverContent align="end" className="w-64 p-3 space-y-3">
                        <div className="text-xs font-semibold text-foreground">Retrieval Hyperparameters</div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[11px]">
                                <span className="text-muted-foreground">Top Results (Top-K)</span>
                                <span className="font-mono font-medium">{hyperparameters.topK}</span>
                            </div>
                            <input
                                type="range"
                                min={2}
                                max={12}
                                step={1}
                                value={hyperparameters.topK}
                                onChange={(e) =>
                                    setHyperparameters({ topK: parseInt(e.target.value, 10) })
                                }
                                className="w-full accent-[var(--accent-brand,#2563EB)]"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[11px]">
                                <span className="text-muted-foreground">Similarity Threshold</span>
                                <span className="font-mono font-medium">
                                    {Math.round(hyperparameters.similarityThreshold * 100)}%
                                </span>
                            </div>
                            <input
                                type="range"
                                min={0.4}
                                max={0.9}
                                step={0.05}
                                value={hyperparameters.similarityThreshold}
                                onChange={(e) =>
                                    setHyperparameters({
                                        similarityThreshold: parseFloat(e.target.value),
                                    })
                                }
                                className="w-full accent-[var(--accent-brand,#2563EB)]"
                            />
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {/* Indexing & Model Status Card */}
                <div className="rounded-xl border border-border/80 bg-card p-3 space-y-2.5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs">
                            {isDocIndexed ? (
                                <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 size={14} />
                                    <span>Indexed ({chunkCount} chunks)</span>
                                </span>
                            ) : (
                                <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                                    <AlertCircle size={14} />
                                    <span>Not indexed</span>
                                </span>
                            )}
                        </div>

                        <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground truncate max-w-[140px]">
                            {embeddingProvider === "local-rust" ? "GTE Small (Local)" : embeddingModel}
                        </span>
                    </div>

                    {/* Local Model Download Banner (if local model not ready) */}
                    {embeddingProvider === "local-rust" && localModelStatus?.isAvailable === false && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
                            <div className="text-xs text-amber-900 dark:text-amber-200">
                                Local embedding model GTE-Small (67MB) required for offline dense search.
                            </div>
                            {isDownloadingModel ? (
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[11px] font-mono text-muted-foreground">
                                        <span>Downloading model...</span>
                                        <span>{downloadProgress?.percent ?? 0}%</span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                        <div
                                            className="h-full bg-[var(--accent-brand,#2563EB)] transition-all duration-200"
                                            style={{ width: `${downloadProgress?.percent ?? 0}%` }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={() => downloadLocalModel()}
                                    className="h-7 w-full gap-1.5 text-xs bg-[var(--accent-brand,#2563EB)] text-white hover:bg-[var(--accent-brand,#2563EB)]/90"
                                >
                                    <Download size={13} />
                                    <span>Download Model (67 MB)</span>
                                </Button>
                            )}
                        </div>
                    )}

                    {/* Indexing Progress */}
                    {isIndexing && (
                        <div className="space-y-1.5 rounded-lg border border-[var(--accent-brand,#2563EB)]/30 bg-[var(--accent-brand,#2563EB)]/5 p-2.5">
                            <div className="flex items-center justify-between text-xs text-[var(--accent-brand,#2563EB)]">
                                <span className="flex items-center gap-1.5 font-medium">
                                    <Loader2 size={13} className="animate-spin" />
                                    <span>Vectorizing document chunks...</span>
                                </span>
                                <span className="font-mono text-[11px]">{indexingProgress}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-[var(--accent-brand,#2563EB)] transition-all duration-300"
                                    style={{ width: `${indexingProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Indexing Error */}
                    {indexingError && (
                        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive flex items-center justify-between gap-2">
                            <span>{indexingError}</span>
                            <Button size="sm" variant="outline" onClick={handleIndexDoc} className="h-6 text-[11px] px-2">
                                Retry
                            </Button>
                        </div>
                    )}

                    {/* Actions: Index, Re-Index, Remove, Inspect */}
                    {!isIndexing && (
                        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                            {isDocIndexed ? (
                                <>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleIndexDoc}
                                        title="Re-run chunk extraction and vector embedding"
                                        className="h-7 gap-1.5 text-xs font-medium flex-1 text-foreground"
                                    >
                                        <RefreshCw size={12} />
                                        <span>Re-index</span>
                                    </Button>

                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleToggleInspectChunks}
                                        className={cn(
                                            "h-7 gap-1.5 text-xs font-medium flex-1",
                                            isInspectChunksMode && "bg-accent text-foreground border-border"
                                        )}
                                    >
                                        <Eye size={12} />
                                        <span>Chunks</span>
                                    </Button>

                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={handleRemoveIndex}
                                        title="Remove from vector index"
                                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                    >
                                        <Trash2 size={13} />
                                    </Button>
                                </>
                            ) : (
                                <Button
                                    size="sm"
                                    onClick={handleIndexDoc}
                                    className="h-7 w-full gap-1.5 text-xs bg-[var(--accent-brand,#2563EB)] text-white hover:bg-[var(--accent-brand,#2563EB)]/90"
                                >
                                    <Sparkles size={13} />
                                    <span>Index Current PDF</span>
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                {/* Inspect Chunks View */}
                {isInspectChunksMode ? (
                    <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">
                                Extracted Chunks ({inspectedChunks.length})
                            </span>

                            {/* Page Filter */}
                            {availablePages.length > 1 && (
                                <select
                                    value={selectedPageFilter}
                                    onChange={(e) =>
                                        setSelectedPageFilter(
                                            e.target.value === "all" ? "all" : parseInt(e.target.value, 10)
                                        )
                                    }
                                    className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground focus:outline-none"
                                >
                                    <option value="all">All Pages</option>
                                    {availablePages.map((p) => (
                                        <option key={p} value={p}>
                                            Page {p}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {isLoadingChunks ? (
                            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                                <Loader2 size={14} className="animate-spin text-[var(--accent-brand,#2563EB)]" />
                                <span>Loading chunks...</span>
                            </div>
                        ) : filteredChunks.length === 0 ? (
                            <div className="py-8 text-center text-xs text-muted-foreground">
                                No chunks found for this document.
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-[460px] overflow-y-auto">
                                {filteredChunks.map((chunk) => (
                                    <div
                                        key={chunk.chunkId}
                                        onClick={() => onJumpToPage(chunk.pageNumber)}
                                        className="group rounded-xl border border-border/80 bg-card p-2.5 space-y-1.5 transition-colors hover:border-[var(--accent-brand,#2563EB)]/60 cursor-pointer shadow-sm"
                                    >
                                        <div className="flex items-center justify-between text-[11px]">
                                            <span className="font-medium text-[var(--accent-brand,#2563EB)]">
                                                Page {chunk.pageNumber} · Chunk #{chunk.chunkIndex + 1}
                                            </span>
                                            <span className="text-muted-foreground font-mono text-[10px]">
                                                {chunk.text.length} chars
                                            </span>
                                        </div>
                                        <p className="text-xs text-foreground/90 leading-relaxed font-mono text-[11px] bg-muted/30 p-2 rounded-md line-clamp-4">
                                            {chunk.text}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    /* Semantic Search View */
                    <div className="space-y-3">
                        {/* Search Input Bar */}
                        <form onSubmit={handleExecuteSearch} className="relative flex items-center">
                            <Search
                                size={14}
                                className="absolute left-3 text-muted-foreground pointer-events-none"
                            />
                            <Input
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder={
                                    searchScope === "current"
                                        ? "Search concepts in this paper..."
                                        : "Search all indexed research papers..."
                                }
                                className="h-9 pl-9 pr-8 text-xs bg-background"
                            />
                            {searchInput && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchInput("");
                                        setRagQuery("");
                                        searchRag("", activeDoc?.id);
                                    }}
                                    className="absolute right-2.5 text-muted-foreground hover:text-foreground"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </form>

                        {/* Search Results List */}
                        {isSearchingRag ? (
                            <div className="flex items-center justify-center py-12 text-xs text-muted-foreground gap-2">
                                <Loader2 size={16} className="animate-spin text-[var(--accent-brand,#2563EB)]" />
                                <span>Scanning vector index...</span>
                            </div>
                        ) : ragResults.length > 0 ? (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                                    <span>{ragResults.length} matching excerpts</span>
                                    <span>Score ≥ {Math.round(hyperparameters.similarityThreshold * 100)}%</span>
                                </div>

                                <div className="space-y-2">
                                    {ragResults.map((result) => {
                                        const isCurrentDoc = activeDoc && result.docId === activeDoc.id;
                                        const isHighlighted =
                                            activeRagHighlight?.chunkId === result.chunkId;

                                        return (
                                            <div
                                                key={result.chunkId}
                                                onClick={() => handleResultClick(result)}
                                                className={cn(
                                                    "group rounded-xl border p-3 space-y-1.5 transition-all cursor-pointer shadow-sm",
                                                    isHighlighted
                                                        ? "border-[var(--accent-brand,#2563EB)] bg-[var(--accent-brand,#2563EB)]/[0.04]"
                                                        : "border-border/80 bg-card hover:border-[var(--accent-brand,#2563EB)]/60 hover:shadow-md"
                                                )}
                                            >
                                                {/* Header: Document Title, Page, Similarity Score */}
                                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                                    <div className="flex items-center gap-1.5 min-w-0">
                                                        <FileText size={12} className="text-muted-foreground shrink-0" />
                                                        <span className="truncate font-medium text-foreground">
                                                            {result.docTitle || "Document"}
                                                        </span>
                                                        <span className="shrink-0 text-muted-foreground font-mono">
                                                            · Page {result.pageNumber}
                                                        </span>
                                                    </div>

                                                    <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
                                                        {Math.round(result.similarityScore * 100)}%
                                                    </span>
                                                </div>

                                                {/* Excerpt Text */}
                                                <p className="text-xs text-foreground/90 leading-relaxed line-clamp-3">
                                                    {result.text}
                                                </p>

                                                <div className="flex items-center justify-between pt-1 text-[10.5px] text-muted-foreground">
                                                    <span>
                                                        {isCurrentDoc ? "Current PDF" : "External PDF"}
                                                    </span>
                                                    <span className="font-medium text-[var(--accent-brand,#2563EB)] group-hover:underline">
                                                        Jump to page →
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : ragQuery ? (
                            <div className="py-12 text-center text-xs text-muted-foreground space-y-1">
                                <p className="font-medium text-foreground">No matching excerpts found</p>
                                <p>Try lowering the similarity threshold or refining query terminology.</p>
                            </div>
                        ) : (
                            /* Initial empty state */
                            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
                                <Database size={24} strokeWidth={1.5} className="text-muted-foreground/60" />
                                <p className="text-xs">Type a query to search semantic concepts across your papers</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
