/**
 * Foliet - LLM Service Types
 */

import type { ToolSet } from "ai";
import type { ChatMessage, LlmProvider } from "@/types/chat";

export interface LlmToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface VisionImageInput {
    dataUrl: string;
    caption?: string;
}

export interface ToolVisionPayload {
    image: VisionImageInput;
    context: string;
}

export interface StreamChatOptions {
    messages: ChatMessage[];
    systemPrompt?: string;
    onChunk: (chunk: string) => void;
    tools?: ToolSet;
    maxSteps?: number;
    webSearchEnabled?: boolean;
    visionImages?: VisionImageInput[];
    hasPendingToolVision?: () => boolean;
    consumePendingToolVision?: () => ToolVisionPayload[];
    signal?: AbortSignal;
    provider?: LlmProvider;
    model?: string;
    apiKey?: string;
    ollamaEndpoint?: string;
}

export interface RagPromptContextItem {
    text: string;
    pageNumber: number;
    docTitle?: string;
}

export type SummaryFocusMode = "executive" | "study" | "technical";

export interface SummaryHighlightInput {
    pageNumber: number;
    toolType: "highlight" | "underline" | "strikethrough";
    text: string;
}

export interface SummaryNoteInput {
    pageNumber: number;
    comment: string;
    contextSnippet?: string;
}

export interface SummaryCropInput {
    id: string;
    pageNumber: number;
    imageUrl: string;
    caption?: string;
    resolvedDataUrl?: string;
}

export interface SummaryChatTakeawayInput {
    title: string;
    excerpts: string[];
}

export interface StructuredSummaryInput {
    docTitle: string;
    focusMode: SummaryFocusMode;
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
    fallbackExcerpt?: string;
}

export interface ChapterSummaryInput {
    docTitle: string;
    chapterTitle: string;
    startPage: number;
    endPage: number;
    focusMode: SummaryFocusMode;
    chapterText: string;
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
    includeNotes?: boolean;
    includeChats?: boolean;
    webSearchEnabled?: boolean;
}

export interface ModifySummaryInput {
    docTitle: string;
    focusMode: SummaryFocusMode;
    existingMarkdown: string;
    instruction: string;
    chapterContext?: {
        title: string;
        startPage: number;
        endPage: number;
        text: string;
    };
    highlights: SummaryHighlightInput[];
    notes: SummaryNoteInput[];
    crops: SummaryCropInput[];
    chatTakeaways: SummaryChatTakeawayInput[];
    includeNotes?: boolean;
    includeChats?: boolean;
    webSearchEnabled?: boolean;
}