/**
 * Foliet - Persistent AI Chat Panel
 *
 * Primary conversational research interface with Lio.
 * Features SQLite-backed persistent conversations, dynamic mascot reaction states,
 * selection snippet handoff from PDF text selection, citation navigation chips,
 * executed tool badges, live OpenRouter web search toggle, and quick LLM config popover.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Globe,
  Plus,
  Quote,
  Settings2,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { AiMascot, type MascotState } from "@/components/ai/AiMascot";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { RagService } from "@/services/rag";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import { LLM_PRESETS } from "@/constants/models";
import type {
  CitationReference,
  ExecutedToolCall,
  LlmProvider,
} from "@/types/chat";
import { cn } from "@/lib/utils";

interface AiChatPanelProps {
  onJumpToPage: (page: number) => void;
}

const INLINE_TOKEN_REGEX =
  /(`[^`\n]+`|\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|\[(?:[^\]\n]*?,\s*)?Page\s+\d+\]|\(Page\s+\d+\))/gi;

async function jumpAndSpotlightPage(
  pageNumber: number,
  onJumpToPage: (page: number) => void,
) {
  onJumpToPage(pageNumber);
  const activeDoc = useDocumentStore.getState().activeDoc;
  if (!activeDoc) return;

  try {
    const chunks = await RagService.getDocumentChunks(activeDoc.id);
    const pageChunks = chunks.filter((c) => c.pageNumber === pageNumber);
    if (pageChunks.length > 0) {
      const mergedRects = pageChunks
        .flatMap((c) => c.rectSegments ?? [])
        .slice(0, 48);
      useRagStore.getState().setActiveRagHighlight({
        chunkId: pageChunks[0].chunkId,
        docId: activeDoc.id,
        docTitle: activeDoc.title,
        pageNumber,
        text: pageChunks[0].text,
        similarityScore: 1.0,
        rectSegments: mergedRects.length > 0 ? mergedRects : undefined,
      });
      return;
    }
  } catch {
    // Fallback below if not indexed
  }

  useRagStore.getState().setActiveRagHighlight({
    chunkId: `chat-citation-page-${pageNumber}`,
    docId: activeDoc.id,
    docTitle: activeDoc.title,
    pageNumber,
    text: `Citation on Page ${pageNumber}`,
    similarityScore: 1.0,
  });
}

function renderInlineMarkdown(
  text: string,
  options: {
    interactiveCitations: boolean;
    onJumpToPage: (page: number) => void;
  },
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  INLINE_TOKEN_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = INLINE_TOKEN_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`tok-${keyIdx++}`}
          className="rounded bg-black/10 dark:bg-white/10 px-1 py-0.5 font-mono text-[11px]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`tok-${keyIdx++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`tok-${keyIdx++}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else {
      const pageMatch = /Page\s+(\d+)/i.exec(token);
      const pageNum = pageMatch ? Number(pageMatch[1]) : NaN;
      if (
        options.interactiveCitations &&
        Number.isFinite(pageNum) &&
        pageNum >= 1
      ) {
        nodes.push(
          <button
            key={`tok-${keyIdx++}`}
            type="button"
            onClick={() =>
              void jumpAndSpotlightPage(pageNum, options.onJumpToPage)
            }
            title={`Jump to Page ${pageNum}`}
            className="mx-0.5 inline-flex items-center rounded border border-[var(--accent-brand,#2563EB)]/30 bg-[var(--accent-brand,#2563EB)]/10 px-1 py-0 font-mono text-[10.5px] font-medium text-[var(--accent-brand,#2563EB)] transition-colors hover:bg-[var(--accent-brand,#2563EB)]/20 cursor-pointer align-baseline"
          >
            {token}
          </button>,
        );
      } else {
        nodes.push(token);
      }
    }

    lastIndex = INLINE_TOKEN_REGEX.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/**
 * Renders message content with support for code blocks, headings, lists,
 * inline formatting, executed tool badges, and clickable citations.
 */
function FormattedMessageContent({
  content,
  isUser,
  isStreaming,
  onJumpToPage,
  citations,
  toolCalls,
}: {
  content: string;
  isUser: boolean;
  isStreaming?: boolean;
  onJumpToPage: (page: number) => void;
  citations?: CitationReference[];
  toolCalls?: ExecutedToolCall[];
}) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopyCode = (code: string, index: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Split text by markdown code blocks: ```lang ... ```
  const segments = useMemo(() => {
    const parts: Array<{
      type: "text" | "code";
      content: string;
      language?: string;
    }> = [];
    const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          content: content.slice(lastIndex, match.index),
        });
      }
      parts.push({
        type: "code",
        language: match[1] || "code",
        content: match[2],
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push({ type: "text", content: content.slice(lastIndex) });
    }

    return parts;
  }, [content]);

  const inlineOpts = {
    interactiveCitations: !isUser,
    onJumpToPage,
  };

  return (
    <div className="space-y-2 text-xs leading-relaxed text-inherit select-text">
      {/* Executed Tool Badges */}
      {toolCalls && toolCalls.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5 select-none">
          {toolCalls.map((tc) => {
            const pageNum = Number(tc.arguments?.pageNumber);
            const hasPage = Number.isFinite(pageNum) && pageNum >= 1;
            return (
              <button
                key={tc.id}
                type="button"
                onClick={hasPage ? () => onJumpToPage(pageNum) : undefined}
                title={tc.result}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                  tc.status === "error"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "border-[var(--accent-brand,#2563EB)]/25 bg-[var(--accent-brand,#2563EB)]/8 text-[var(--accent-brand,#2563EB)]",
                  hasPage &&
                    "cursor-pointer hover:bg-[var(--accent-brand,#2563EB)]/15",
                )}
              >
                <span>{tc.badgeLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      {segments.map((seg, idx) => {
        if (seg.type === "code") {
          return (
            <div
              key={idx}
              className="relative my-2 overflow-hidden rounded-lg border border-border bg-zinc-950 text-zinc-100 dark:bg-zinc-900"
            >
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1 text-[11px] font-mono text-zinc-400 select-none">
                <span>{seg.language || "text"}</span>
                <button
                  type="button"
                  onClick={() => handleCopyCode(seg.content, idx)}
                  className="flex items-center gap-1 hover:text-zinc-200"
                >
                  {copiedIndex === idx ? (
                    <>
                      <Check size={12} className="text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-normal select-text">
                <code>{seg.content}</code>
              </pre>
            </div>
          );
        }

        // Split plain text into lines/paragraphs
        const lines = seg.content.split("\n");
        return (
          <div key={idx} className="space-y-1.5">
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lineIdx} className="h-0.5" />;

              // Horizontal rule
              if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
                return <hr key={lineIdx} className="my-2 border-border/60" />;
              }

              // Headings (# to ####)
              const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
              if (headingMatch) {
                const level = headingMatch[1].length;
                const headingText = headingMatch[2];
                return (
                  <div
                    key={lineIdx}
                    className={cn(
                      "font-semibold text-inherit",
                      level === 1 && "pt-2 text-[14px]",
                      level === 2 && "pt-2 text-[13px]",
                      level >= 3 && "pt-1.5 text-xs",
                    )}
                  >
                    {renderInlineMarkdown(headingText, inlineOpts)}
                  </div>
                );
              }

              // Blockquote
              if (trimmed.startsWith("> ")) {
                return (
                  <blockquote
                    key={lineIdx}
                    className="border-l-2 border-[var(--accent-brand,#2563EB)]/40 pl-2.5 italic opacity-90"
                  >
                    {renderInlineMarkdown(trimmed.slice(2), inlineOpts)}
                  </blockquote>
                );
              }

              // Unordered bullet point (- or *)
              if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2 pl-1">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-brand,#2563EB)]" />
                    <span className="min-w-0 flex-1">
                      {renderInlineMarkdown(trimmed.slice(2), inlineOpts)}
                    </span>
                  </div>
                );
              }

              // Ordered list item (1. , 2. , etc.)
              const orderedMatch = /^(\d+\.)\s+(.+)$/.exec(trimmed);
              if (orderedMatch) {
                return (
                  <div key={lineIdx} className="flex items-start gap-1.5 pl-1">
                    <span className="shrink-0 font-mono text-[11px] font-semibold opacity-80">
                      {orderedMatch[1]}
                    </span>
                    <span className="min-w-0 flex-1">
                      {renderInlineMarkdown(orderedMatch[2], inlineOpts)}
                    </span>
                  </div>
                );
              }

              return (
                <p key={lineIdx}>{renderInlineMarkdown(line, inlineOpts)}</p>
              );
            })}
          </div>
        );
      })}

      {/* Streaming typing cursor indicator */}
      {isStreaming && (
        <span className="inline-block h-3.5 w-1.5 animate-pulse bg-[var(--accent-brand,#2563EB)] align-middle ml-0.5" />
      )}

      {/* Clickable Citations */}
      {citations && citations.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40 select-none">
          <span className="text-[11px] font-medium text-muted-foreground">
            Sources:
          </span>
          {citations.map((c, cIdx) => (
            <button
              key={cIdx}
              type="button"
              onClick={() => {
                onJumpToPage(c.pageNumber);
                useRagStore.getState().setActiveRagHighlight({
                  chunkId: c.chunkId,
                  docId: c.docId,
                  docTitle: c.docTitle,
                  pageNumber: c.pageNumber,
                  text: c.snippet,
                  similarityScore: 1.0,
                });
              }}
              title={`Jump to Page ${c.pageNumber}: "${c.snippet.slice(0, 100)}..."`}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--accent-brand,#2563EB)]/30 bg-[var(--accent-brand,#2563EB)]/5 px-2 py-0.5 font-mono text-[11px] font-medium text-[var(--accent-brand,#2563EB)] transition-colors hover:bg-[var(--accent-brand,#2563EB)]/15 active:scale-95"
            >
              <span>Page {c.pageNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const AiChatPanel: React.FC<AiChatPanelProps> = ({ onJumpToPage }) => {
  const [inputText, setInputText] = useState("");
  const [useRagContext, setUseRagContext] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeDoc = useDocumentStore((s) => s.activeDoc);

  const {
    conversations,
    activeConversationId,
    isStreaming,
    pendingContextSnippet,
    loadConversations,
    setActiveConversationId,
    createConversation,
    deleteConversation,
    sendMessage,
    cancelStreaming,
    setPendingContextSnippet,
    setViewerJumpHandler,
  } = useChatStore(
    useShallow((s) => ({
      conversations: s.conversations,
      activeConversationId: s.activeConversationId,
      isStreaming: s.isStreaming,
      pendingContextSnippet: s.pendingContextSnippet,
      loadConversations: s.loadConversations,
      setActiveConversationId: s.setActiveConversationId,
      createConversation: s.createConversation,
      deleteConversation: s.deleteConversation,
      sendMessage: s.sendMessage,
      cancelStreaming: s.cancelStreaming,
      setPendingContextSnippet: s.setPendingContextSnippet,
      setViewerJumpHandler: s.setViewerJumpHandler,
    })),
  );

  const {
    llmProvider,
    llmModel,
    apiKeys,
    ollamaEndpoint,
    webSearchEnabled,
    setLlmProvider,
    setLlmModel,
    setApiKey,
    setOllamaEndpoint,
    setWebSearchEnabled,
  } = useAiConfigStore(
    useShallow((s) => ({
      llmProvider: s.llmProvider,
      llmModel: s.llmModel,
      apiKeys: s.apiKeys,
      ollamaEndpoint: s.ollamaEndpoint,
      webSearchEnabled: s.webSearchEnabled,
      setLlmProvider: s.setLlmProvider,
      setLlmModel: s.setLlmModel,
      setApiKey: s.setApiKey,
      setOllamaEndpoint: s.setOllamaEndpoint,
      setWebSearchEnabled: s.setWebSearchEnabled,
    })),
  );

  // Register viewer jump handler so tool calls (navigate_to, explain_figure) can jump pages
  useEffect(() => {
    setViewerJumpHandler(onJumpToPage);
    return () => {
      setViewerJumpHandler(null);
    };
  }, [onJumpToPage, setViewerJumpHandler]);

  // Load conversations for the current document
  useEffect(() => {
    loadConversations(activeDoc?.id);
  }, [activeDoc?.id, loadConversations]);

  // Auto-scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, isStreaming]);

  // Auto-focus input when a selection snippet arrives from "Ask Lio"
  useEffect(() => {
    if (pendingContextSnippet) {
      inputRef.current?.focus();
    }
  }, [pendingContextSnippet]);

  const activeConv = useMemo(
    () =>
      conversations.find((c) => c.id === activeConversationId) ??
      conversations[0],
    [conversations, activeConversationId],
  );

  // Calculate dynamic mascot mood
  const mascotState: MascotState = useMemo(() => {
    if (isStreaming) {
      const lastMsg = activeConv?.messages[activeConv.messages.length - 1];
      return !lastMsg?.content ? "thinking" : "speaking";
    }
    if (pendingContextSnippet) return "curious";
    return "idle";
  }, [isStreaming, activeConv, pendingContextSnippet]);

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text && !pendingContextSnippet) return;

    setInputText("");
    const promptText = text || "Can you explain this excerpt in context?";
    await sendMessage(promptText, {
      docId: activeDoc?.id,
      docTitle: activeDoc?.title,
      useRag: useRagContext,
      onNavigateToPage: onJumpToPage,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handlePromptSuggestion = (prompt: string) => {
    sendMessage(prompt, {
      docId: activeDoc?.id,
      docTitle: activeDoc?.title,
      useRag: useRagContext,
      onNavigateToPage: onJumpToPage,
    });
  };

  const currentProviderPresets = LLM_PRESETS[llmProvider] || [];
  const currentModelLabel =
    currentProviderPresets.find((m) => m.id === llmModel)?.label ||
    llmModel ||
    "Model";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Top Sub-Bar: Mascot, Conversation Switcher, LLM Badge */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/80 bg-muted/20 px-3 select-none">
        {/* Conversation Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex max-w-[200px] items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <AiMascot size={18} state={mascotState} className="shrink-0" />
                <span className="truncate">
                  {activeConv?.title || "New Chat"}
                </span>
                <ChevronDown
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-64 p-1">
            <DropdownMenuItem
              onClick={() => createConversation("New Chat", activeDoc?.id)}
              className="flex items-center gap-2 cursor-pointer font-medium text-[var(--accent-brand,#2563EB)]"
            >
              <Plus size={14} />
              <span>New conversation</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setActiveConversationId(c.id)}
                  className={cn(
                    "group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors",
                    c.id === activeConv?.id
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="truncate flex-1">{c.title}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    title="Delete chat"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Quick Model Badge + API Settings Trigger */}
        <Popover open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                title="Configure LLM Provider & API Keys"
                className="flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="max-w-[100px] truncate">
                  {currentModelLabel}
                </span>
                <Settings2 size={12} className="text-muted-foreground" />
              </button>
            }
          />
          <PopoverContent align="end" className="w-80 p-3 space-y-3">
            <div className="text-xs font-semibold text-foreground">
              LLM Provider & Model
            </div>

            {/* Provider selection */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                Provider
              </label>
              <select
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value as LlmProvider)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand,#2563EB)]"
              >
                <option value="openrouter">OpenRouter (Recommended)</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google-ai-studio">Google AI Studio</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>

            {/* Model selection */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                Model Preset
              </label>
              <select
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-[var(--accent-brand,#2563EB)]"
              >
                {currentProviderPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key or Endpoint */}
            {llmProvider === "ollama" ? (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Ollama Endpoint
                </label>
                <Input
                  value={ollamaEndpoint}
                  onChange={(e) => setOllamaEndpoint(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="h-8 text-xs font-mono"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {llmProvider.toUpperCase()} API Key
                </label>
                <Input
                  type="password"
                  value={apiKeys[llmProvider] || ""}
                  onChange={(e) => setApiKey(llmProvider, e.target.value)}
                  placeholder="sk-..."
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}

            <div className="pt-1 flex justify-end">
              <Button
                size="sm"
                onClick={() => setIsSettingsOpen(false)}
                className="h-7 text-xs"
              >
                Done
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 select-text">
        {!activeConv?.messages || activeConv.messages.length === 0 ? (
          /* Scholarly Empty State */
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center px-4 py-8 select-none">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-card/60 shadow-sm">
              <AiMascot size={42} state="curious" />
            </div>
            <div className="space-y-1 max-w-[260px]">
              <h3 className="text-sm font-semibold text-foreground">
                Scholarly Assistant
              </h3>
              <p className="text-xs text-muted-foreground">
                Ask questions, explore hypotheses, or highlight text in the
                paper to consult Lio.
              </p>
            </div>

            <div className="mt-3 flex w-full flex-col gap-1.5 max-w-[280px]">
              <button
                type="button"
                onClick={() =>
                  handlePromptSuggestion(
                    "What is the central objective and primary thesis of this paper?",
                  )
                }
                className="rounded-lg border border-border/80 bg-card px-3 py-2 text-left text-xs text-foreground/90 transition-colors hover:border-[var(--accent-brand,#2563EB)]/40 hover:bg-[var(--accent-brand,#2563EB)]/5"
              >
                What is the central thesis?
              </button>
              <button
                type="button"
                onClick={() =>
                  handlePromptSuggestion(
                    "Can you break down the mathematical formulation and methodology?",
                  )
                }
                className="rounded-lg border border-border/80 bg-card px-3 py-2 text-left text-xs text-foreground/90 transition-colors hover:border-[var(--accent-brand,#2563EB)]/40 hover:bg-[var(--accent-brand,#2563EB)]/5"
              >
                Explain the core methodology
              </button>
              <button
                type="button"
                onClick={() =>
                  handlePromptSuggestion(
                    "What limitations or benchmark trade-offs do the authors note?",
                  )
                }
                className="rounded-lg border border-border/80 bg-card px-3 py-2 text-left text-xs text-foreground/90 transition-colors hover:border-[var(--accent-brand,#2563EB)]/40 hover:bg-[var(--accent-brand,#2563EB)]/5"
              >
                Highlight limitations & trade-offs
              </button>
            </div>
          </div>
        ) : (
          /* Messages List */
          activeConv.messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className={cn(
                  "flex flex-col gap-1 max-w-[92%]",
                  isUser ? "ml-auto items-end" : "mr-auto items-start",
                )}
              >
                {/* Role / Avatar Indicator */}
                {!isUser && (
                  <div className="flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-muted-foreground select-none">
                    <AiMascot size={14} state="idle" interactive={false} />
                    <span>Lio</span>
                  </div>
                )}

                <div
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-xs shadow-sm select-text",
                    isUser
                      ? "bg-[var(--accent-brand,#2563EB)] text-[var(--accent-brand-fg,#ffffff)] rounded-tr-sm [&::selection]:bg-white/35 [&_*::selection]:bg-white/35 [&_*::selection]:text-white"
                      : "border border-border/80 bg-card text-foreground rounded-tl-sm",
                  )}
                >
                  <FormattedMessageContent
                    content={msg.content}
                    isUser={isUser}
                    isStreaming={msg.isStreaming}
                    onJumpToPage={onJumpToPage}
                    citations={msg.citations}
                    toolCalls={msg.toolCalls}
                  />
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Footer */}
      <div className="border-t border-border bg-card/60 p-3 space-y-2">
        {/* Selection Context Snippet Pill (from Ask Lio) */}
        {pendingContextSnippet && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--accent-brand,#2563EB)]/30 bg-[var(--accent-brand,#2563EB)]/5 px-2.5 py-1.5 text-xs text-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Quote
                size={13}
                className="shrink-0 text-[var(--accent-brand,#2563EB)]"
              />
              <span className="font-medium text-[var(--accent-brand,#2563EB)] shrink-0">
                Page {pendingContextSnippet.pageNumber}:
              </span>
              <span className="truncate italic text-muted-foreground">
                "{pendingContextSnippet.snippet}"
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPendingContextSnippet(null)}
              title="Remove attached quote"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Textarea Input */}
        <div className="relative rounded-xl border border-border bg-background focus-within:border-[var(--accent-brand,#2563EB)] focus-within:ring-1 focus-within:ring-[var(--accent-brand,#2563EB)] transition-colors">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              pendingContextSnippet
                ? "Ask about this passage..."
                : "Ask Lio about this paper..."
            }
            rows={2}
            className="w-full resize-none bg-transparent px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />

          {/* Bottom Toolbar inside Composer */}
          <div className="flex items-center justify-between gap-2 border-t border-border/40 px-2.5 py-1.5 select-none">
            <div className="flex items-center gap-1.5">
              {/* RAG Context Toggle */}
              <button
                type="button"
                onClick={() => setUseRagContext(!useRagContext)}
                title={
                  activeDoc?.isIndexed
                    ? "Ground answers using semantic paper excerpts"
                    : "Paper not yet indexed (will search catalog or use direct model knowledge)"
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                  useRagContext
                    ? "bg-[var(--accent-brand,#2563EB)]/10 text-[var(--accent-brand,#2563EB)]"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <BookOpen size={13} />
                <span>RAG Search: {useRagContext ? "On" : "Off"}</span>
              </button>

              {/* OpenRouter Live Web Search Toggle */}
              {llmProvider === "openrouter" && (
                <button
                  type="button"
                  onClick={() => void setWebSearchEnabled(!webSearchEnabled)}
                  title="Enable OpenRouter live web search plugin"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    webSearchEnabled
                      ? "bg-[var(--accent-brand,#2563EB)]/10 text-[var(--accent-brand,#2563EB)]"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Globe size={13} />
                  <span>Web: {webSearchEnabled ? "On" : "Off"}</span>
                </button>
              )}
            </div>

            {/* Send / Stop Streaming Button */}
            {isStreaming ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={cancelStreaming}
                className="h-7 gap-1 rounded-lg px-2.5 text-xs"
              >
                <Square size={11} fill="currentColor" />
                <span>Stop</span>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleSendMessage}
                disabled={!inputText.trim() && !pendingContextSnippet}
                className="h-7 gap-1 rounded-lg px-2.5 text-xs bg-[var(--accent-brand,#2563EB)] hover:bg-[var(--accent-brand,#2563EB)]/90 text-white"
              >
                <span>Send</span>
                <ArrowUp size={12} strokeWidth={2} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
