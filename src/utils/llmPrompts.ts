/**
 * Foliet - Grounded RAG & Living Summary Prompt Builders
 */

import type {
    ChapterSummaryInput,
    ModifySummaryInput,
    RagPromptContextItem,
    StructuredSummaryInput,
    SummaryFocusMode,
} from "@/services/llm/types";
import {
    formatRagPassages,
    formatSummaryContextBlocks,
} from "@/utils/llmFormatting";

export interface SummaryPromptFlags {
    includeNotes?: boolean;
    includeChats?: boolean;
    webSearchEnabled?: boolean;
}

const CITATION_FORMAT_RULE =
    "Cite page numbers inline using bracketed format `[Page X]` (e.g., `[Page 4]`).";
const FIGURE_SYNTAX_RULE =
    "Embed figures on their own line using `![Concise figure description (Page X)](idb://crop-...)`. Never invent, modify, or shorten image URIs.";
const FENCED_CODE_RULE =
    "Whenever explaining an algorithm, formula, protocol, pseudocode, or code structure, ALWAYS wrap it in a fenced code block with an explicit language tag (e.g., ```python, ```typescript, ```rust, ```latex).";
const MARKDOWN_ONLY_RULE =
    "Return valid Markdown only—no conversational preamble or meta-commentary.";

const SUMMARY_MODE_GUIDANCE: Record<SummaryFocusMode, string> = {
    study: [
        "STYLE MODE: Study Notes",
        "- Pedagogical, clear, and structured for deep retention and review.",
        "- Define core concepts, highlight intuition alongside key facts, and end chapters with concise takeaway bullets.",
    ].join("\n"),
    executive: [
        "STYLE MODE: Executive Brief",
        "- Crisp, high-signal, and decision-oriented.",
        "- Lead with thesis, key conclusions, empirical metrics, and practical implications or limitations.",
        "- Keep prose tight; avoid verbose step-by-step repetition.",
    ].join("\n"),
    technical: [
        "STYLE MODE: Technical & Code",
        "- Rigorous focus on system architecture, formal definitions, equations, algorithms, benchmarks, and trade-offs.",
        `- ${FENCED_CODE_RULE}`,
    ].join("\n"),
};

const STRUCTURED_FOCUS_OUTLINES: Record<SummaryFocusMode, string> = {
    executive: [
        "FOCUS MODE: Executive Brief",
        "Organize with clean Markdown headings:",
        "1. `# <Concise Document Title>`",
        "2. `## Thesis & Problem Statement`",
        "3. `## Core Findings & Evidence` (anchored in the user's highlighted passages)",
        "4. `## Methodology & Synthesis`",
        "5. `## Limitations & Open Questions`",
    ].join("\n"),
    study: [
        "FOCUS MODE: Study Notes",
        "Organize with clean Markdown headings:",
        "1. `# <Concise Study Title>`",
        "2. `## Core Concepts & Definitions`",
        "3. `## Detailed Walkthrough` (synthesized from the marked passages by theme or progression)",
        "4. `## Marginalia & Resolved Questions` (directly addressing the user's personal notes and Lio chat takeaways)",
        "5. `## Key Takeaways for Review`",
    ].join("\n"),
    technical: [
        "FOCUS MODE: Technical & Code",
        "Organize with clean Markdown headings:",
        "1. `# <Concise Technical Title>`",
        "2. `## System Architecture & Formalisms`",
        "3. `## Algorithms, Equations & Code` (present algorithms, data structures, mathematical formulations, or implementations inside fenced code blocks with language tags)",
        "4. `## Benchmarks & Empirical Results`",
        "5. `## Implementation Notes & Trade-offs`",
    ].join("\n"),
};

export function buildRagSystemPrompt(
    chunks: RagPromptContextItem[],
    docTitle?: string,
    toolsEnabled?: boolean,
): string {
    const toolNote = toolsEnabled
        ? [
            "5. COPILOT TOOLS: You have tools to interact with the PDF viewer (`navigate_to`, `highlight_passage`, `explain_figure`, `add_figure_to_summary`). Calling `navigate_to` or `explain_figure` also returns that page's text so you can read it, and `add_figure_to_summary` captures a page figure and inserts it into the living summary. Never print raw tool logs or JSON tool syntax in your final response.",
        ]
        : [];

    return [
        `You are Foliet's scholarly research assistant (Lio). The user currently has the document "${docTitle || "Current PDF"}" open in the PDF viewer.`,
        "Your task is to provide rigorous, accurate, and insightful answers based on the retrieved document excerpts below.",
        "",
        "GUIDELINES:",
        "1. GROUNDING & FIDELITY: Base your statements directly on the provided passages. Do not extrapolate unsupported claims.",
        "2. CITATIONS: Whenever stating a finding, metric, argument, or fact from a passage, explicitly cite the source page using bracketed format, e.g., [Page X] or [Title, Page X].",
        "3. UNKNOWN / ABSENT INFO: If the provided excerpts do not contain enough information to answer a question definitively, state clearly that the retrieved excerpts do not cover that point (or call `navigate_to` to inspect an earlier/relevant page).",
        "4. SCHOLARLY TONE: Maintain a concise, academic tone. Avoid marketing hype, conversational fluff, and unnecessary adjectives.",
        ...toolNote,
        "",
        "RETRIEVED DOCUMENT EXCERPTS:",
        formatRagPassages(chunks, docTitle),
    ].join("\n");
}

function buildContextToggleGuidance(flags?: SummaryPromptFlags): string[] {
    const lines: string[] = [];
    if (flags?.includeNotes) {
        lines.push(
            "- USER ANNOTATIONS: Weave the user's supplied highlights, underlines, and personal sticky notes into the synthesis.",
        );
    }
    if (flags?.includeChats) {
        lines.push(
            "- CHAT TAKEAWAYS: Incorporate relevant insights and clarifications from the supplied Lio Q&A takeaways.",
        );
    }
    if (flags?.webSearchEnabled) {
        lines.push(
            "- WEB SEARCH: Live web search is enabled. You may integrate verified external context or follow-up developments by citing the external source/URL explicitly, while keeping `[Page X]` strictly for claims from the PDF.",
        );
    }
    return lines;
}

export function buildSummarySystemPrompt(
    focusMode: SummaryFocusMode,
    docTitle: string,
    flags?: SummaryPromptFlags,
): string {
    const toggleGuidance = buildContextToggleGuidance(flags);
    return [
        `You are Foliet's scholarly synthesis assistant maintaining a Living Summary for "${docTitle}".`,
        "",
        SUMMARY_MODE_GUIDANCE[focusMode],
        "",
        "GLOBAL OUTPUT RULES:",
        `- GROUNDING & CITATIONS: Anchor claims directly in the supplied source text${flags?.includeNotes ? " and user annotations" : ""}. ${CITATION_FORMAT_RULE}`,
        ...toggleGuidance,
        `- FIGURES: When figure crop URIs (\`idb://crop-...\`) are provided, ${FIGURE_SYNTAX_RULE}`,
        "- TOOL USAGE: If the user asks to include a figure from a page that does not yet have a crop URI, you may call `add_figure_to_summary`.",
        `- OUTPUT FORMAT: ${MARKDOWN_ONLY_RULE}`,
    ].join("\n");
}

export function buildChapterSummaryPrompt(input: ChapterSummaryInput): string {
    const contextBlocks = formatSummaryContextBlocks(input);
    const contextNotices: string[] = [];
    if (input.includeNotes && (input.highlights.length > 0 || input.notes.length > 0)) {
        contextNotices.push(
            "Incorporate the user's highlights and personal sticky notes provided below.",
        );
    }
    if (input.includeChats && input.chatTakeaways.length > 0) {
        contextNotices.push(
            "Incorporate relevant clarifications from the saved Lio chat takeaways provided below.",
        );
    }
    if (input.webSearchEnabled) {
        contextNotices.push(
            "Live web search is enabled to verify or enrich background references where helpful.",
        );
    }

    return [
        `Synthesize a structured Markdown summary section for the following chapter of "${input.docTitle}".`,
        `CHAPTER: "${input.chapterTitle}" (Pages ${input.startPage}–${input.endPage})`,
        "",
        "Start the output directly with the exact heading:",
        `## ${input.chapterTitle}`,
        "",
        "Use `###` subheadings where helpful, bullet points for key mechanisms/results, and `[Page X]` citations throughout.",
        ...contextNotices,
        "",
        "CHAPTER TEXT / EXCERPTS:",
        input.chapterText.trim() || "(No extractable text found in this page range.)",
        contextBlocks ? `\n\n${contextBlocks}` : "",
    ].join("\n");
}

export function buildModifySummaryPrompt(input: ModifySummaryInput): string {
    const contextBlocks = formatSummaryContextBlocks(input);
    const chapterBlock = input.chapterContext
        ? [
            `ACTIVE CHAPTER CONTEXT: "${input.chapterContext.title}" (Pages ${input.chapterContext.startPage}–${input.chapterContext.endPage})`,
            input.chapterContext.text.trim(),
        ].join("\n")
        : "";
    const activeFlags = buildContextToggleGuidance({
        includeNotes: input.includeNotes,
        includeChats: input.includeChats,
        webSearchEnabled: input.webSearchEnabled,
    });

    return [
        "Modify or refine the EXISTING SUMMARY MARKDOWN below according to the USER INSTRUCTION.",
        "Preserve unaffected sections, headings, `[Page X]` citations, and existing `![...](idb://...)` image links unless the instruction explicitly asks to remove or rewrite them.",
        "Return the complete updated Markdown document only.",
        ...activeFlags,
        "",
        `USER INSTRUCTION: ${input.instruction.trim()}`,
        "",
        "EXISTING SUMMARY MARKDOWN:",
        input.existingMarkdown.trim() || "(Empty document)",
        chapterBlock ? `\n${chapterBlock}` : "",
        contextBlocks ? `\n${contextBlocks}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildStructuredSummarizationPrompt(
    input: StructuredSummaryInput,
): string {
    const hasAttachedImages = input.crops.some((c) => Boolean(c.resolvedDataUrl));
    const figureRule =
        input.crops.length > 0
            ? `- FIGURE CROPS (IMAGES): ${hasAttachedImages
                ? "Inspect the attached figure images carefully to describe their visual data, trends, axes, and diagrams accurately. "
                : ""
            }${FIGURE_SYNTAX_RULE} Only reference URIs listed in USER CAPTURED FIGURE CROPS.`
            : "- Do not invent or emit image links.";

    return [
        `You are Foliet's scholarly research assistant synthesizing personal research notes for "${input.docTitle}".`,
        "",
        STRUCTURED_FOCUS_OUTLINES[input.focusMode],
        "",
        "STRICT SYNTHESIS RULES:",
        "- ANCHOR ON USER MARKUPS: Center the entire document around the user's selected highlights, underlines, and personal sticky notes below rather than producing generic filler.",
        `- PAGE CITATIONS: ${CITATION_FORMAT_RULE}`,
        "- INTEGRATE CHAT INSIGHTS: Incorporate relevant answers or clarifications from the selected Lio Chat Takeaways naturally into the synthesis.",
        `- FENCED CODE BLOCKS: ${FENCED_CODE_RULE}`,
        figureRule,
        `- OUTPUT FORMAT: ${MARKDOWN_ONLY_RULE}`,
        "",
        formatSummaryContextBlocks(input, { structuredPlaceholders: true }),
        input.fallbackExcerpt?.trim()
            ? `\nADDITIONAL DOCUMENT EXCERPTS:\n${input.fallbackExcerpt.trim()}`
            : "",
    ].join("\n");
}