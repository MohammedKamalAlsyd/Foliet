/**
 * Foliet - AI Studio Resizable Right Sidebar Shell
 *
 * Houses Lio Chat, RAG Semantic Vector Search, and the live Summary Studio
 * directly inside unified tabs — no extra "Split View" launcher gate.
 */

import React, { Suspense, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Database,
  FileText,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiStudioStore } from "@/stores/aiStudioStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSummaryStore } from "@/stores/summaryStore";
import type { PdfAnnotation } from "@/types/annotations";

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
  const { isSummaryWorkspaceOpen, loadSummary, setSummaryWorkspaceOpen } =
    useSummaryStore(
      useShallow((s) => ({
        isSummaryWorkspaceOpen: s.isSummaryWorkspaceOpen,
        loadSummary: s.loadSummary,
        setSummaryWorkspaceOpen: s.setSummaryWorkspaceOpen,
      })),
    );

  // If external actions (e.g. "Insert in Summary") request opening the summary workspace,
  // focus the unified Summarize tab directly.
  useEffect(() => {
    if (isSummaryWorkspaceOpen) {
      setActiveAiTab("summary");
      setAiStudioOpen(true);
    }
  }, [isSummaryWorkspaceOpen, setActiveAiTab, setAiStudioOpen]);

  useEffect(() => {
    if ((isOpen || isSummaryWorkspaceOpen) && activeDoc?.id) {
      loadSummary(activeDoc.id);
    }
  }, [isOpen, isSummaryWorkspaceOpen, activeDoc?.id, loadSummary]);

  if (!isOpen && !isSummaryWorkspaceOpen) return null;

  const normalizedTab =
    activeAiTab === "chunks" || activeAiTab === "settings"
      ? "search"
      : activeAiTab;

  const handleCloseStudio = () => {
    window.dispatchEvent(new Event("foliet:flush-summary"));
    setSummaryWorkspaceOpen(false);
    setAiStudioOpen(false);
  };

  return (
    <aside
      aria-label="AI Studio Sidebar"
      className="flex h-full w-full flex-col bg-card"
    >
      <Tabs
        value={normalizedTab}
        onValueChange={(val) => {
          const next = val as "chat" | "search" | "summary";
          setActiveAiTab(next);
          if (next !== "summary" && isSummaryWorkspaceOpen) {
            setSummaryWorkspaceOpen(false);
          }
        }}
        className="flex h-full flex-col overflow-hidden"
      >
        {/* 48px Top Tab Bar: Matches PdfSidebar & PdfToolbar alignment */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-2.5 select-none">
          <TabsList className="h-8 gap-0.5 rounded-lg border border-border/60 bg-background/80 p-0.5">
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
            onClick={handleCloseStudio}
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

        {/* Tab 3: Direct Summary Studio (no intermediate launch screen) */}
        <TabsContent value="summary" className="m-0 flex-1 overflow-hidden p-0">
          <Suspense fallback={<PanelFallback label="Loading summary studio…" />}>
            <LazySummarizationWorkspace
              embedded
              annotations={annotations}
              onJumpToPage={onJumpToPage}
            />
          </Suspense>
        </TabsContent>
      </Tabs>
    </aside>
  );
};
