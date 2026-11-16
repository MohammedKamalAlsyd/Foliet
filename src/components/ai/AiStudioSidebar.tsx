/**
 * Foliet - AI Studio Resizable Right Sidebar Shell
 *
 * Houses Lio Chat, RAG Semantic Vector Search, and Document Summarization.
 * Mirrors the structure, styling, and drag-to-resize behavior of PdfSidebar,
 * persisting width to localStorage.
 */

import React, { useState } from "react";
import {
    Database,
    FileText,
    MessageSquare,
    Sparkles,
    X,
} from "lucide-react";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { RagSearchPanel } from "@/components/ai/RagSearchPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAiStore } from "@/stores/aiStore";
import { cn } from "@/lib/utils";

interface AiStudioSidebarProps {
    isOpen: boolean;
    onJumpToPage: (page: number) => void;
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
}) => {
    const [width, setWidth] = useState<number>(readStoredWidth);
    const [isResizing, setIsResizing] = useState(false);

    const { activeAiTab, setActiveAiTab, setAiStudioOpen } = useAiStore();

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
        <aside
            style={{ width }}
            aria-label="AI Studio Sidebar"
            className="relative z-20 flex h-full shrink-0 flex-col border-l border-border bg-card shadow-[-4px_0_12px_rgba(0,0,0,0.03)] select-none"
        >
            <Tabs
                value={activeAiTab === "chunks" || activeAiTab === "settings" ? "search" : activeAiTab}
                onValueChange={(val) => setActiveAiTab(val as "chat" | "search" | "summary")}
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
                <TabsContent value="search" className="m-0 flex-1 overflow-hidden p-0">
                    <RagSearchPanel onJumpToPage={onJumpToPage} />
                </TabsContent>

                {/* Tab 3: Summarization Placeholder (Ready for Phase 5) */}
                <TabsContent value="summary" className="m-0 flex-1 overflow-y-auto p-4">
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-4 py-12">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card shadow-sm text-[var(--accent-brand,#2563EB)]">
                            <Sparkles size={22} strokeWidth={1.5} />
                        </div>
                        <div className="space-y-1 max-w-[260px]">
                            <h3 className="text-sm font-semibold text-foreground">Document Summarizer</h3>
                            <p className="text-xs text-muted-foreground">
                                Objective structured academic synthesis, methodology extraction, and key metrics.
                            </p>
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
                        ? "after:bg-[var(--accent-brand,#2563EB)]"
                        : "hover:after:bg-[var(--accent-brand,#2563EB)]/60"
                )}
            />
        </aside>
    );
};
