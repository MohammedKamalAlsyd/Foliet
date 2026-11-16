/**
 * Foliet - AI Studio Resizable Right Sidebar Shell
 *
 * Houses Lio Chat, RAG Semantic Vector Search, and Document Summarization.
 * Mirrors the structure, styling, and drag-to-resize behavior of PdfSidebar,
 * persisting width to localStorage.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Database,
  FileText,
  MessageSquare,
  X,
} from "lucide-react";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { RagSearchPanel } from "@/components/ai/RagSearchPanel";
import { SummarizationWorkspace } from "@/components/ai/SummarizationWorkspace";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";
import {
  isCropAnnotation,
  isNoteAnnotation,
  isTextMarkupAnnotation,
  type PdfAnnotation,
} from "@/types/annotations";
import { cn } from "@/lib/utils";

interface AiStudioSidebarProps {
  isOpen: boolean;
  onJumpToPage: (page: number) => void;
  annotations?: PdfAnnotation[];
}

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 300;
const MAX_WIDTH = 620;
const WIDTH_STORAGE_KEY = "foliet:ai-sidebar-width";

const clampWidth = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));

function readStoredWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export const AiStudioSidebar: React.FC<AiStudioSidebarProps> = ({
  isOpen,
  onJumpToPage,
  annotations = [],
}) => {
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [isResizing, setIsResizing] = useState(false);

  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const {
    activeAiTab,
    setActiveAiTab,
    setAiStudioOpen,
    activeSummary,
    loadSummary,
    conversations,
    setSummaryWorkspaceOpen,
  } = useAiStore();

  useEffect(() => {
    if (isOpen && activeDoc?.id) {
      loadSummary(activeDoc.id);
    }
  }, [isOpen, activeDoc?.id, loadSummary]);

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

    const chats = conversations.filter((c) => c.messages.length > 0).length;
    return { highlights, underlines, notes, crops, chats };
  }, [annotations, conversations]);

  const updateWidth = (next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    try {
      localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore quota errors
    }
  };

  const handleResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = width;

    const onPointerMove = (moveEvt: PointerEvent) => {
      // Dragging cursor to the left expands the right sidebar
      const delta = moveEvt.clientX - startX;
      updateWidth(startWidth - delta);
    };

    const onPointerUp = () => {
      setIsResizing(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  if (!isOpen) return null;

  return (
    <>
      <aside
        style={{ width }}
        aria-label="AI Studio Sidebar"
        className="relative z-20 flex h-full shrink-0 flex-col border-l border-border bg-card shadow-[-4px_0_12px_rgba(0,0,0,0.03)] select-none"
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
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-muted/30 px-2.5">
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
            <AiChatPanel onJumpToPage={onJumpToPage} />
          </TabsContent>

          {/* Tab 2: RAG Search */}
          <TabsContent
            value="search"
            className="m-0 flex-1 overflow-hidden p-0"
          >
            <RagSearchPanel onJumpToPage={onJumpToPage} />
          </TabsContent>

          {/* Tab 3: Summarization Studio Launch Panel */}
          <TabsContent
            value="summary"
            className="m-0 flex-1 overflow-y-auto p-4"
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium text-foreground">
                    Document synthesis
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Synthesize your marked passages, sticky notes, figure crops,
                    and Lio conversations into an editable Markdown document.
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
                  Open Summarization Studio
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Drag-to-resize handle on LEFT edge */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize AI Studio sidebar"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          title="Drag to resize · Double-click to reset"
          onPointerDown={handleResizePointerDown}
          onDoubleClick={() => updateWidth(DEFAULT_WIDTH)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") updateWidth(width + 16);
            else if (e.key === "ArrowRight") updateWidth(width - 16);
          }}
          className={cn(
            "absolute top-0 -left-1 z-20 h-full w-2 cursor-col-resize",
            "after:absolute after:top-0 after:bottom-0 after:left-[3px] after:w-0.5 after:transition-colors after:duration-150 after:ease-[var(--ease-foliet)]",
            isResizing
              ? "after:bg-[var(--accent-brand)]"
              : "hover:after:bg-[var(--accent-brand)]/60",
          )}
        />
      </aside>

      <SummarizationWorkspace annotations={annotations} />
    </>
  );
};
