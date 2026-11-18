/**
 * Foliet - RAG Search & Indexing Panel
 *
 * Implements dense semantic retrieval across the active PDF or entire library,
 * dynamic embedding provider/model configuration (ONNX HF repos & remote APIs),
 * local model download/deletion lifecycle, live page/chunk indexing progress,
 * scanned-PDF error reporting, and chunk inspection.
 */

import React, { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  Eye,
  FileText,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
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
import { EMBEDDING_PRESETS } from "@/constants/models";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import type { EmbeddingProvider, RagSearchResult } from "@/types/embedding";
import { cn } from "@/lib/utils";

interface RagSearchPanelProps {
  onJumpToPage: (page: number) => void;
}

const STAGE_LABELS: Record<string, string> = {
  extracting: "Extracting text",
  chunking: "Filtering & chunking",
  embedding: "Generating embeddings",
  saving: "Saving index",
};

export const RagSearchPanel: React.FC<RagSearchPanelProps> = ({
  onJumpToPage,
}) => {
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
    isIndexing,
    indexingProgress,
    indexingProgressDetail,
    indexingError,
    indexDocument,
    removeDocumentIndex,
    localModelStatus,
    isDownloadingModel,
    downloadProgress,
    downloadedModels,
    isDeletingModel,
    downloadLocalModel,
    deleteLocalModel,
    inspectedChunks,
    isLoadingChunks,
    inspectChunksForDocument,
  } = useRagStore(
    useShallow((s) => ({
      catalog: s.catalog,
      searchScope: s.searchScope,
      setSearchScope: s.setSearchScope,
      ragQuery: s.ragQuery,
      setRagQuery: s.setRagQuery,
      ragResults: s.ragResults,
      isSearchingRag: s.isSearchingRag,
      searchRag: s.searchRag,
      activeRagHighlight: s.activeRagHighlight,
      setActiveRagHighlight: s.setActiveRagHighlight,
      isIndexing: s.isIndexing,
      indexingProgress: s.indexingProgress,
      indexingProgressDetail: s.indexingProgressDetail,
      indexingError: s.indexingError,
      indexDocument: s.indexDocument,
      removeDocumentIndex: s.removeDocumentIndex,
      localModelStatus: s.localModelStatus,
      isDownloadingModel: s.isDownloadingModel,
      downloadProgress: s.downloadProgress,
      downloadedModels: s.downloadedModels,
      isDeletingModel: s.isDeletingModel,
      downloadLocalModel: s.downloadLocalModel,
      deleteLocalModel: s.deleteLocalModel,
      inspectedChunks: s.inspectedChunks,
      isLoadingChunks: s.isLoadingChunks,
      inspectChunksForDocument: s.inspectChunksForDocument,
    })),
  );

  const [isInspectChunksMode, setInspectChunksMode] = useState(false);

  const {
    hyperparameters,
    setHyperparameters,
    embeddingProvider,
    embeddingModel,
    embeddingApiKey,
    setEmbeddingProvider,
    setEmbeddingModel,
    setEmbeddingApiKey,
  } = useAiConfigStore(
    useShallow((s) => ({
      hyperparameters: s.hyperparameters,
      setHyperparameters: s.setHyperparameters,
      embeddingProvider: s.embeddingProvider,
      embeddingModel: s.embeddingModel,
      embeddingApiKey: s.embeddingApiKey,
      setEmbeddingProvider: s.setEmbeddingProvider,
      setEmbeddingModel: s.setEmbeddingModel,
      setEmbeddingApiKey: s.setEmbeddingApiKey,
    })),
  );

  const [searchInput, setSearchInput] = useState(ragQuery);
  const [selectedPageFilter, setSelectedPageFilter] = useState<number | "all">(
    "all",
  );
  const [isEmbedSettingsOpen, setIsEmbedSettingsOpen] = useState(false);
  const [customModelInput, setCustomModelInput] = useState(embeddingModel);

  // Check if active document is indexed in rag.db catalog
  const catalogEntry = catalog.documents.find((d) => d.docId === activeDoc?.id);
  const isDocIndexed = Boolean(catalogEntry);
  const chunkCount = catalogEntry?.chunkCount ?? 0;

  useEffect(() => {
    setSearchInput(ragQuery);
  }, [ragQuery]);

  useEffect(() => {
    setCustomModelInput(embeddingModel);
  }, [embeddingModel]);

  const handleExecuteSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = searchInput.trim();
    setRagQuery(q);
    searchRag(q, activeDoc?.id);
  };

  const handleIndexDoc = async () => {
    if (!activeDoc?.filePath) return;
    await indexDocument(activeDoc.id, activeDoc.title, activeDoc.filePath);
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

  const handleApplyCustomModel = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = customModelInput.trim();
    if (!trimmed) return;
    await setEmbeddingModel(trimmed);
  };

  const handleResultClick = (result: RagSearchResult) => {
    setActiveRagHighlight(result);

    if (activeDoc && result.docId === activeDoc.id) {
      onJumpToPage(result.pageNumber);
    } else {
      const targetCatalog = catalog.documents.find(
        (d) => d.docId === result.docId,
      );
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
    selectedPageFilter === "all"
      ? true
      : chunk.pageNumber === selectedPageFilter,
  );

  const availablePages = Array.from(
    new Set(inspectedChunks.map((c) => c.pageNumber)),
  ).sort((a, b) => a - b);

  const providerPresets = EMBEDDING_PRESETS[embeddingProvider] ?? [];
  const activePreset = providerPresets.find((p) => p.id === embeddingModel);
  const shortModelBadge =
    activePreset?.label ??
    (embeddingModel.includes("/")
      ? embeddingModel.split("/").pop()
      : embeddingModel);

  const needsLocalDownload =
    embeddingProvider === "local-rust" &&
    localModelStatus?.isAvailable === false;
  const needsRemoteApiKey =
    (embeddingProvider === "voyage" || embeddingProvider === "openai") &&
    !embeddingApiKey.trim();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top Sub-Bar: Scope Switcher & Hyperparameters */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/80 bg-muted/20 px-3">
        <div className="flex items-center rounded-lg border border-border/70 bg-muted/50 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setSearchScope("current")}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              searchScope === "current"
                ? "bg-card text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground",
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
                : "text-muted-foreground hover:text-foreground",
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
                <span>
                  K={hyperparameters.topK} ·{" "}
                  {Math.round(hyperparameters.similarityThreshold * 100)}%
                </span>
              </button>
            }
          />
          <PopoverContent align="end" className="w-64 p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">
              Retrieval Hyperparameters
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">
                  Top Results (Top-K)
                </span>
                <span className="font-mono font-medium">
                  {hyperparameters.topK}
                </span>
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
                <span className="text-muted-foreground">
                  Similarity Threshold
                </span>
                <span className="font-mono font-medium">
                  {Math.round(hyperparameters.similarityThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.3}
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
        {/* Indexing & Embedding Model Card */}
        <div className="rounded-xl border border-border/80 bg-card p-3 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs min-w-0">
              {isDocIndexed ? (
                <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={14} className="shrink-0" />
                  <span className="truncate">
                    Indexed ({chunkCount} chunks)
                  </span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>Not indexed</span>
                </span>
              )}
            </div>

            {/* Embedding Provider & Dynamic Model Popover */}
            <Popover
              open={isEmbedSettingsOpen}
              onOpenChange={setIsEmbedSettingsOpen}
            >
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    title="Configure Embedding Provider, Model & Storage"
                    className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:border-border hover:text-foreground max-w-[165px]"
                  >
                    <span className="truncate">{shortModelBadge}</span>
                    <Settings2 size={11} className="shrink-0" />
                  </button>
                }
              />
              <PopoverContent align="end" className="w-80 p-3 space-y-3">
                <div className="text-xs font-semibold text-foreground">
                  Embedding Provider & Model
                </div>

                {/* Provider Selection */}
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Provider
                  </label>
                  <select
                    value={embeddingProvider}
                    onChange={(e) =>
                      setEmbeddingProvider(e.target.value as EmbeddingProvider)
                    }
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand,#2563EB)]"
                  >
                    <option value="local-rust">Local ONNX (Rust CPU)</option>
                    <option value="voyage">Voyage AI (API)</option>
                    <option value="openai">OpenAI (API)</option>
                    <option value="ollama">Ollama (Local Server)</option>
                  </select>
                </div>

                {/* Preset Model Picker */}
                {providerPresets.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Preset Models
                    </label>
                    <select
                      value={
                        providerPresets.some((p) => p.id === embeddingModel)
                          ? embeddingModel
                          : "__custom__"
                      }
                      onChange={(e) => {
                        if (e.target.value !== "__custom__") {
                          setEmbeddingModel(e.target.value);
                        }
                      }}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand,#2563EB)]"
                    >
                      {providerPresets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} ({p.dimensions}d)
                        </option>
                      ))}
                      {!providerPresets.some(
                        (p) => p.id === embeddingModel,
                      ) && (
                        <option value="__custom__">
                          Custom ({embeddingModel})
                        </option>
                      )}
                    </select>
                  </div>
                )}

                {/* Dynamic HF Repo ID / Custom Remote Model Input */}
                <form onSubmit={handleApplyCustomModel} className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {embeddingProvider === "local-rust"
                      ? "Hugging Face ONNX Repo ID"
                      : "Custom Model ID"}
                  </label>
                  <div className="flex gap-1.5">
                    <Input
                      value={customModelInput}
                      onChange={(e) => setCustomModelInput(e.target.value)}
                      placeholder={
                        embeddingProvider === "local-rust"
                          ? "e.g. Xenova/bge-base-en-v1.5"
                          : "e.g. voyage-3-large"
                      }
                      className="h-8 text-xs font-mono"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={
                        !customModelInput.trim() ||
                        customModelInput.trim() === embeddingModel
                      }
                      className="h-8 px-2.5 text-xs shrink-0"
                    >
                      Use
                    </Button>
                  </div>
                </form>

                {/* Remote API Key Input */}
                {(embeddingProvider === "voyage" ||
                  embeddingProvider === "openai") && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {embeddingProvider === "voyage"
                        ? "Voyage API Key"
                        : "OpenAI API Key"}
                    </label>
                    <Input
                      type="password"
                      value={embeddingApiKey}
                      onChange={(e) => setEmbeddingApiKey(e.target.value)}
                      placeholder={
                        embeddingProvider === "voyage" ? "pa-..." : "sk-..."
                      }
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                )}

                {/* Downloaded Local Models & Storage Cleanup */}
                {downloadedModels.length > 0 && (
                  <div className="space-y-1.5 border-t border-border pt-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <HardDrive size={12} />
                      <span>Downloaded Local Models</span>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {downloadedModels.map((m) => (
                        <div
                          key={m.dirName}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1 text-[11px]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-foreground">
                              {m.modelId}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {m.fileSizeMb} MB
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={isDeletingModel || isIndexing}
                            onClick={() => deleteLocalModel(m.modelId)}
                            title={`Remove ${m.modelId} from disk`}
                            className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <Button
                    size="sm"
                    onClick={() => setIsEmbedSettingsOpen(false)}
                    className="h-7 text-xs"
                  >
                    Done
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Local Model Download / Remove Banner */}
          {embeddingProvider === "local-rust" && needsLocalDownload && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-2">
              <div className="text-xs text-amber-900 dark:text-amber-200">
                Local ONNX model{" "}
                <span className="font-mono font-medium">{embeddingModel}</span>{" "}
                is required for offline dense search.
              </div>
              {isDownloadingModel ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-muted-foreground">
                    <span>Downloading ONNX & tokenizer...</span>
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
                  <span>Download Local Model</span>
                </Button>
              )}
              {downloadProgress?.error && (
                <div className="text-[11px] text-destructive">
                  {downloadProgress.error}
                </div>
              )}
            </div>
          )}

          {/* Quick Remove Local Model Row when Downloaded */}
          {embeddingProvider === "local-rust" &&
            localModelStatus?.isAvailable &&
            localModelStatus.fileSizeMb > 0 && (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-mono">
                  On disk: {localModelStatus.fileSizeMb} MB
                </span>
                <button
                  type="button"
                  disabled={isDeletingModel || isIndexing}
                  onClick={() => deleteLocalModel(embeddingModel)}
                  className="text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                >
                  {isDeletingModel ? "Removing..." : "Remove Model"}
                </button>
              </div>
            )}

          {/* Missing Remote API Key Notice */}
          {needsRemoteApiKey && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
              <span>API key required for {embeddingProvider}.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsEmbedSettingsOpen(true)}
                className="h-6 px-2 text-[11px]"
              >
                Set Key
              </Button>
            </div>
          )}

          {/* Live Page & Chunk Indexing Progress */}
          {isIndexing && (
            <div className="space-y-1.5 rounded-lg border border-[var(--accent-brand,#2563EB)]/30 bg-[var(--accent-brand,#2563EB)]/5 p-2.5">
              <div className="flex items-center justify-between text-xs text-[var(--accent-brand,#2563EB)]">
                <span className="flex items-center gap-1.5 font-medium">
                  <Loader2 size={13} className="animate-spin" />
                  <span>
                    {STAGE_LABELS[
                      indexingProgressDetail?.stage ?? "extracting"
                    ] ?? "Indexing"}
                  </span>
                </span>
                <span className="font-mono text-[11px]">
                  {indexingProgress}%
                </span>
              </div>

              {indexingProgressDetail && (
                <div className="font-mono text-[11px] text-muted-foreground">
                  Page {indexingProgressDetail.currentPage} /{" "}
                  {indexingProgressDetail.totalPages || "?"} · Chunk{" "}
                  {indexingProgressDetail.processedChunks} /{" "}
                  {indexingProgressDetail.totalChunks || "?"}
                </div>
              )}

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-[var(--accent-brand,#2563EB)] transition-all duration-200"
                  style={{ width: `${indexingProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Scanned PDF / Indexing Error Banner */}
          {indexingError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="leading-relaxed">{indexingError}</span>
              </div>
              {activeDoc?.filePath && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleIndexDoc}
                    disabled={needsLocalDownload || needsRemoteApiKey}
                    className="h-6 text-[11px] px-2"
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Actions: Index, Re-Index, Inspect Chunks, Clear Index */}
          {!isIndexing && (
            <div className="flex items-center gap-2 pt-1 border-t border-border/50">
              {isDocIndexed ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleIndexDoc}
                    disabled={
                      !activeDoc?.filePath ||
                      needsLocalDownload ||
                      needsRemoteApiKey
                    }
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
                      isInspectChunksMode &&
                        "bg-accent text-foreground border-border",
                    )}
                  >
                    <Eye size={12} />
                    <span>Chunks</span>
                  </Button>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleRemoveIndex}
                    title="Remove embeddings / clear index for this PDF"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 size={13} />
                    <span>Clear</span>
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={handleIndexDoc}
                  disabled={
                    !activeDoc?.filePath ||
                    needsLocalDownload ||
                    needsRemoteApiKey
                  }
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

              {availablePages.length > 1 && (
                <select
                  value={selectedPageFilter}
                  onChange={(e) =>
                    setSelectedPageFilter(
                      e.target.value === "all"
                        ? "all"
                        : parseInt(e.target.value, 10),
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
                <Loader2
                  size={14}
                  className="animate-spin text-[var(--accent-brand,#2563EB)]"
                />
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
            <form
              onSubmit={handleExecuteSearch}
              className="relative flex items-center"
            >
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

            {isSearchingRag ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground gap-2">
                <Loader2
                  size={16}
                  className="animate-spin text-[var(--accent-brand,#2563EB)]"
                />
                <span>Scanning vector index...</span>
              </div>
            ) : ragResults.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                  <span>{ragResults.length} matching excerpts</span>
                  <span>
                    Score ≥{" "}
                    {Math.round(hyperparameters.similarityThreshold * 100)}%
                  </span>
                </div>

                <div className="space-y-2">
                  {ragResults.map((result) => {
                    const isCurrentDoc =
                      activeDoc && result.docId === activeDoc.id;
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
                            : "border-border/80 bg-card hover:border-[var(--accent-brand,#2563EB)]/60 hover:shadow-md",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText
                              size={12}
                              className="text-muted-foreground shrink-0"
                            />
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
                <p className="font-medium text-foreground">
                  No matching excerpts found
                </p>
                <p>
                  Try lowering the similarity threshold or refining query
                  terminology.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
                <Database
                  size={24}
                  strokeWidth={1.5}
                  className="text-muted-foreground/60"
                />
                <p className="text-xs">
                  Type a query to search semantic concepts across your papers
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
