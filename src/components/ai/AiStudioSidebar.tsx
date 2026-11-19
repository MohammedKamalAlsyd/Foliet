/**
 * Foliet - AI Studio Resizable Right Sidebar Shell
 *
 * Houses Lio Chat, RAG Semantic Vector Search, and Document Summarization.
 * When Summarization Studio is open, renders the split-screen Living Summary
 * pane alongside the live PDF viewer inside ViewerView's ResizablePanelGroup.
 */

import React, { Suspense, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSummaryStore } from "@/stores/summaryStore";
import {
  isCropAnnotation,
  isNoteAnnotation,
  isTextMarkupAnnotation,
  type PdfAnnotation,
} from "@/types/annotations";

const LazyAiChatPanel = React.lazy(() =>
  import("@/components/ai/AiChatPanel").then((m) => ({
    default: m.AiChatPanel,
  })),
);
const LazyRagSearchPanel = React.lazy(() =>
  import("@/components/ai/RagSearchPanel").then((m) => ({
    default: m.RagSearchPanel,
  })),
);
const LazySummarizationWorkspace = React.lazy(() =>
  import("@/components/ai/SummarizationWorkspace").then((m) => ({
    default: m.SummarizationWorkspace,
  })),
);

const PanelFallback: React.FC<{ label?: string }> = ({
  label = "Loading…",
}) => (
  <div className="flex h-full w-full items-center justify-center gap-2 bg-background text-xs text-muted-foreground">
    <Loader2 size={14} className="animate-spin" />
    <span>{label}</span>
  </div>
);

interface AiStudioSidebarProps {
  isOpen: boolean;
  onJumpToPage: (page: number) => void;
  annotations?: PdfAnnotation[];
}

export const AiStudioSidebar: React.FC<AiStudioSidebarProps> = ({
  isOpen,
  onJumpToPage,
  annotations = [],
}) => {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const { activeAiTab, setActiveAiTab, setAiStudioOpen } = useAiStudioStore(
    useShallow((s) => ({
      activeAiTab: s.activeAiTab,
      setActiveAiTab: s.setActiveAiTab,
      setAiStudioOpen: s.setAiStudioOpen,
    })),
  );
  const {
    activeSummary,
    isSummaryWorkspaceOpen,
    loadSummary,
    setSummaryWorkspaceOpen,
  } = useSummaryStore(
    useShallow((s) => ({
      activeSummary: s.activeSummary,
      isSummaryWorkspaceOpen: s.isSummaryWorkspaceOpen,
      loadSummary: s.loadSummary,
      setSummaryWorkspaceOpen: s.setSummaryWorkspaceOpen,
    })),
  );
  const savedChatsCount = useChatStore((s) =>
    s.conversations.reduce(
      (count, c) => count + (c.messages.length > 0 ? 1 : 0),
      0,
    ),
  );

  useEffect(() => {
    if ((isOpen || isSummaryWorkspaceOpen) && activeDoc?.id) {
      loadSummary(activeDoc.id);
    }
  }, [isOpen, isSummaryWorkspaceOpen, activeDoc?.id, loadSummary]);

  const sourceCounts = useMemo(() => {
    let highlights = 0;
    let underlines = 0;
    let notes = 0;
    let crops = 0;

    for (const a of annotations) {
      if (isTextMarkupAnnotation(a)) {
        if (a.toolType === "highlight") highlights += 1;
        else if (a.toolType === "underline") underlines += 1;
      } else if (isNoteAnnotation(a)) {
        notes += 1;
      } else if (isCropAnnotation(a)) {
        crops += 1;
      }
    }

    return { highlights, underlines, notes, crops, chats: savedChatsCount };
  }, [annotations, savedChatsCount]);

  if (!isOpen && !isSummaryWorkspaceOpen) return null;

  if (isSummaryWorkspaceOpen) {
    return (
      <Suspense fallback={<PanelFallback label="Loading summary workspace…" />}>
        <LazySummarizationWorkspace
          annotations={annotations}
          onJumpToPage={onJumpToPage}
        />
      </Suspense>
    );
  }

  return (
    <aside
      aria-label="AI Studio Sidebar"
      className="flex h-full w-full flex-col bg-card"
    >
      <Tabs
        value={
          activeAiTab === "chunks" || activeAiTab === "settings"
            ? "search"
            : activeAiTab
        }
        onValueChange={(val) =>
          setActiveAiTab(val as "chat" | "search" | "summary")
        }
        className="flex h-full flex-col overflow-hidden"
      >
        {/* 48px Top Tab Bar: Matches PdfSidebar & PdfToolbar alignment */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-2.5 select-none">
          <TabsList className="h-8 gap-0.5 rounded-lg bg-background/80 p-0.5 border border-border/60">
            <TabsTrigger
              value="chat"
              className="h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <MessageSquare size={13} strokeWidth={1.5} />
              <span>Chat</span>
            </TabsTrigger>
            <TabsTrigger
              value="search"
              className="h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <Database size={13} strokeWidth={1.5} />
              <span>RAG Search</span>
            </TabsTrigger>
            <TabsTrigger
              value="summary"
              className="h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
            >
              <FileText size={13} strokeWidth={1.5} />
              <span>Summarize</span>
            </TabsTrigger>
          </TabsList>

          {/* Close Studio Button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setAiStudioOpen(false)}
            aria-label="Close AI Studio"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={15} strokeWidth={1.75} />
          </Button>
        </div>

        {/* Tab 1: Persistent Chat */}
        <TabsContent value="chat" className="m-0 flex-1 overflow-hidden p-0">
          <Suspense fallback={<PanelFallback label="Loading chat…" />}>
            <LazyAiChatPanel onJumpToPage={onJumpToPage} />
          </Suspense>
        </TabsContent>

        {/* Tab 2: RAG Search */}
        <TabsContent value="search" className="m-0 flex-1 overflow-hidden p-0">
          <Suspense fallback={<PanelFallback label="Loading RAG search…" />}>
            <LazyRagSearchPanel onJumpToPage={onJumpToPage} />
          </Suspense>
        </TabsContent>

        {/* Tab 3: Summarization Studio Launch Panel */}
        <TabsContent value="summary" className="m-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-background p-4 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  Living Summary Split View
                </h3>
                <p className="text-xs text-muted-foreground">
                  Open a split-screen Markdown editor alongside the PDF for
                  chapter-by-chapter synthesis, figure embedding, and `.docx`
                  export.
                </p>
              </div>

              {/* Source Counts Grid */}
              <div className="divide-y divide-border rounded-lg border border-border bg-card">
                <div className="flex h-8 items-center justify-between px-3 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    Highlights
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {sourceCounts.highlights}
                  </span>
                </div>
                <div className="flex h-8 items-center justify-between px-3 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    Underlines
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {sourceCounts.underlines}
                  </span>
                </div>
                <div className="flex h-8 items-center justify-between px-3 text-xs">
                  <span className="text-[var(--text-secondary)]">Notes</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {sourceCounts.notes}
                  </span>
                </div>
                <div className="flex h-8 items-center justify-between px-3 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    Figure crops
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {sourceCounts.crops}
                  </span>
                </div>
                <div className="flex h-8 items-center justify-between px-3 text-xs">
                  <span className="text-[var(--text-secondary)]">
                    Saved conversations
                  </span>
                  <span className="font-mono tabular-nums text-foreground">
                    {sourceCounts.chats}
                  </span>
                </div>
              </div>

              {/* SQLite Saved Status */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
                {activeSummary?.content ? (
                  <span className="flex items-center gap-2 text-foreground">
                    <CheckCircle2
                      size={14}
                      strokeWidth={1.5}
                      className="text-[var(--semantic-positive)] shrink-0"
                    />
                    <span>Saved summary available</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    No saved summary yet
                  </span>
                )}
              </div>

              <Button
                type="button"
                onClick={() => setSummaryWorkspaceOpen(true)}
                disabled={!activeDoc}
                className="h-9 w-full rounded-lg bg-[var(--accent-brand)] text-xs font-medium text-[var(--accent-brand-fg)] hover:opacity-90"
              >
                Open Summary Split View
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  );
};
