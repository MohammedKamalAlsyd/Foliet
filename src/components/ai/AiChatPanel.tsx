/**
 * Foliet - Persistent AI Chat Panel
 *
 * Primary conversational research interface with Lio.
 * Features SQLite-backed persistent conversations, dynamic mascot reaction states,
 * selection snippet handoff from PDF text selection, citation navigation chips,
 * executed tool badges, live OpenRouter web search toggle, and quick LLM config popover.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { toast } from "sonner";
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
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useChatStore } from "@/stores/chatStore";
import { useDocumentStore } from "@/stores/documentStore";
import { LLM_PRESETS } from "@/constants/models";
import type {
  ChatMessage,
  CitationReference,
  ExecutedToolCall,
  LlmProvider,
} from "@/types/chat";
import {
  PAGE_CITATION_REGEX,
  extractSentenceAroundOffset,
  jumpAndSpotlightCitation,
} from "@/utils/citationSpotlight";
import { cn } from "@/lib/utils";

interface AiChatPanelProps {
  onJumpToPage: (page: number) => void;
}

const CITATION_PREPROCESS_RE = new RegExp(
  "(```[\\s\\S]*?```|`[^`\\n]+`|\\[[^\\]\\n]*\\]\\([^)\\n]*\\))|" +
    PAGE_CITATION_REGEX.source,
  "gi",
);

function preprocessCitations(content: string): {
  markdown: string;
  contexts: string[];
} {
  const contexts: string[] = [];
  const markdown = content.replace(
    CITATION_PREPROCESS_RE,
    (
      full,
      skip,
      bracketCite,
      bracketPage,
      parenCite,
      parenPage,
      offset: number,
    ) => {
      if (skip) return full;
      const page = bracketPage ?? parenPage;
      const label = bracketCite ?? parenCite;
      const idx = contexts.length;
      contexts.push(
        extractSentenceAroundOffset(content, offset, offset + full.length),
      );
      return `[${label}](#foliet-page-${page}-${idx})`;
    },
  );
  return { markdown, contexts };
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy code to clipboard");
    }
  };

  return (
    <div className="relative my-2 overflow-hidden rounded-lg border border-border bg-zinc-950 text-zinc-100 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-3 py-1 font-mono text-[11px] text-zinc-400 select-none">
        <span>{language}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex items-center gap-1 hover:text-zinc-200"
        >
          {copied ? (
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
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Renders message content via react-markdown with custom code blocks,
 * executed tool badges, and clickable `[Page X]` / `(Page X)` citations.
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
  const { markdown: markdownSource, contexts: citationContexts } = useMemo(
    () =>
      isUser
        ? { markdown: content, contexts: [] }
        : preprocessCitations(content),
    [content, isUser],
  );

  const markdownComponents = useMemo<Components>(
    () => ({
      h1: ({ children }) => (
        <h1 className="pt-2 text-[14px] font-semibold text-inherit">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="pt-2 text-[13px] font-semibold text-inherit">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="pt-1.5 text-xs font-semibold text-inherit">
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4 className="pt-1.5 text-xs font-semibold text-inherit">
          {children}
        </h4>
      ),
      p: ({ children }) => <p className="leading-relaxed">{children}</p>,
      ul: ({ children }) => (
        <ul className="list-disc space-y-1 pl-4 marker:text-[var(--accent-brand,#2563EB)]">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="list-decimal space-y-1 pl-4 marker:font-mono marker:text-[11px] marker:font-semibold">
          {children}
        </ol>
      ),
      li: ({ children }) => <li className="pl-0.5">{children}</li>,
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-[var(--accent-brand,#2563EB)]/40 pl-2.5 italic opacity-90">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-2 border-border/60" />,
      strong: ({ children }) => (
        <strong className="font-semibold">{children}</strong>
      ),
      em: ({ children }) => <em className="italic">{children}</em>,
      code: ({ children }) => (
        <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">
          {children}
        </code>
      ),
      pre: ({ children }) => {
        const codeEl = React.isValidElement<{
          className?: string;
          children?: React.ReactNode;
        }>(children)
          ? children
          : null;
        const lang =
          /language-([^\s]+)/.exec(codeEl?.props?.className ?? "")?.[1] ||
          "text";
        const raw = String(codeEl?.props?.children ?? children ?? "").replace(
          /\n$/,
          "",
        );
        return <CodeBlock language={lang} code={raw} />;
      },
      a: ({ href, children }) => {
        const pageMatch = /^#foliet-page-(\d+)(?:-(\d+))?$/.exec(href ?? "");
        if (pageMatch) {
          const pageNum = Number(pageMatch[1]);
          const ctxIdx = pageMatch[2] !== undefined ? Number(pageMatch[2]) : -1;
          const contextText =
            ctxIdx >= 0 ? citationContexts[ctxIdx] : undefined;
          return (
            <button
              type="button"
              onClick={() =>
                void jumpAndSpotlightCitation({
                  pageNumber: pageNum,
                  contextText,
                  onJumpToPage,
                })
              }
              title={`Jump to Page ${pageNum}`}
              className="mx-0.5 inline-flex cursor-pointer items-center rounded border border-[var(--accent-brand,#2563EB)]/30 bg-[var(--accent-brand,#2563EB)]/10 px-1 py-0 align-baseline font-mono text-[10.5px] font-medium text-[var(--accent-brand,#2563EB)] transition-colors hover:bg-[var(--accent-brand,#2563EB)]/20"
            >
              {children}
            </button>
          );
        }
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "underline underline-offset-2 hover:opacity-80",
              isUser ? "text-inherit" : "text-[var(--accent-brand,#2563EB)]",
            )}
          >
            {children}
          </a>
        );
      },
    }),
    [isUser, onJumpToPage, citationContexts],
  );

  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-inherit select-text">
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

      <ReactMarkdown components={markdownComponents}>
        {markdownSource}
      </ReactMarkdown>

      {/* Streaming typing cursor indicator */}
      {isStreaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--accent-brand,#2563EB)] align-middle" />
      )}

      {/* Clickable Citations */}
      {citations && citations.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-1 select-none">
          <span className="text-[11px] font-medium text-muted-foreground">
            Sources:
          </span>
          {citations.map((c, cIdx) => (
            <button
              key={cIdx}
              type="button"
              onClick={() =>
                void jumpAndSpotlightCitation({
                  pageNumber: c.pageNumber,
                  chunkId: c.chunkId,
                  docId: c.docId,
                  docTitle: c.docTitle,
                  snippet: c.snippet,
                  rectSegments: c.rectSegments,
                  onJumpToPage,
                })
              }
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

const ChatMessageBubble = React.memo(function ChatMessageBubble({
  message,
  onJumpToPage,
}: {
  message: ChatMessage;
  onJumpToPage: (page: number) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div
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
            ? "bg-[var(--accent-brand,#2563EB)] text-[var(--accent-brand-fg)] rounded-tr-sm [&::selection]:bg-white/35 [&_*::selection]:bg-white/35 [&_*::selection]:text-[var(--accent-brand-fg)]"
            : "border border-border/80 bg-card text-foreground rounded-tl-sm",
        )}
      >
        <FormattedMessageContent
          content={message.content}
          isUser={isUser}
          isStreaming={message.isStreaming}
          onJumpToPage={onJumpToPage}
          citations={message.citations}
          toolCalls={message.toolCalls}
        />
      </div>
    </div>
  );
});

export const AiChatPanel: React.FC<AiChatPanelProps> = ({ onJumpToPage }) => {
  const [inputText, setInputText] = useState("");
  const [useRagContext, setUseRagContext] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef(true);

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

  const activeConv = useMemo(
    () =>
      conversations.find((c) => c.id === activeConversationId) ??
      conversations[0],
    [conversations, activeConversationId],
  );

  const activeConvId = activeConv?.id ?? null;
  const messageCount = activeConv?.messages.length ?? 0;
  const lastMessage =
    messageCount > 0 ? activeConv?.messages[messageCount - 1] : undefined;
  const lastMessageContentLen = lastMessage?.content.length ?? 0;
  const lastMessageToolCount = lastMessage?.toolCalls?.length ?? 0;

  // Reset stick-to-bottom when switching conversations
  useEffect(() => {
    isNearBottomRef.current = true;
  }, [activeConvId]);

  // Auto-scroll messages to bottom only when already near bottom
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [
    activeConvId,
    messageCount,
    lastMessageContentLen,
    lastMessageToolCount,
    isStreaming,
  ]);

  // Auto-focus input when a selection snippet arrives from "Ask Lio"
  useEffect(() => {
    if (pendingContextSnippet) {
      inputRef.current?.focus();
    }
  }, [pendingContextSnippet]);

  // Calculate dynamic mascot mood
  const mascotState: MascotState = useMemo(() => {
    if (isStreaming) {
      const lastMsg = activeConv?.messages[activeConv.messages.length - 1];
      return !lastMsg?.content ? "thinking" : "speaking";
    }
    if (pendingContextSnippet) return "curious";
    return "idle";
  }, [isStreaming, activeConv, pendingContextSnippet]);

  const handleMessagesScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text && !pendingContextSnippet) return;

    isNearBottomRef.current = true;
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
    isNearBottomRef.current = true;
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
                <DropdownMenuItem
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
                      e.preventDefault();
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    title="Delete chat"
                  >
                    <Trash2 size={13} />
                  </button>
                </DropdownMenuItem>
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
      <div
        ref={scrollContainerRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 select-text"
      >
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
          activeConv.messages.map((msg) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              onJumpToPage={onJumpToPage}
            />
          ))
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
                className="h-7 gap-1 rounded-lg px-2.5 text-xs bg-[var(--accent-brand,#2563EB)] hover:bg-[var(--accent-brand,#2563EB)]/90 text-[var(--accent-brand-fg)]"
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
