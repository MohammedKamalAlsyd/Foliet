/**
 * Foliet - Grounded RAG & Compact Summary Prompt Builders
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
    hasNotes?: boolean;
    hasChats?: boolean;
    hasCrops?: boolean;
    webSearchEnabled?: boolean;
}

const MODE_RULES: Record<SummaryFocusMode, string> = {
    study:
        "Mode: Study Notes — clear, structured for retention; explain core concepts, mechanisms, and key takeaways.",
    executive:
        "Mode: Executive Brief — crisp and decision-oriented; lead with thesis, empirical metrics, implications, and limits.",
    technical:
        "Mode: Technical & Code — focus on architecture, equations, algorithms, benchmarks, and trade-offs; wrap formulas/pseudocode/code in fenced blocks with language tags.",
};

const STRUCTURED_OUTLINES: Record<SummaryFocusMode, string> = {
    executive:
        "Headings: `# <Title>`, `## Thesis & Problem`, `## Core Findings & Evidence`, `## Methodology`, `## Limitations & Open Questions`.",
    study:
        "Headings: `# <Title>`, `## Core Concepts`, `## Key Walkthrough`, `## Synthesis & Insights`, `## Review Takeaways`.",
    technical:
        "Headings: `# <Title>`, `## Architecture & Formalisms`, `## Algorithms, Equations & Code`, `## Benchmarks`, `## Trade-offs`.",
};

export function buildRagSystemPrompt(
    chunks: RagPromptContextItem[],
    docTitle?: string,
    toolsEnabled?: boolean,
): string {
    const toolLine = toolsEnabled
        ? "Tools: `navigate_to`, `highlight_passage`, `explain_figure`, `add_figure_to_summary`. Never print raw JSON or tool logs."
        : "";

    return [
        `You are Lio, Foliet's scholarly assistant for "${docTitle || "Current PDF"}".`,
        "Rules:",
        "- Ground claims in the excerpts below and cite pages inline as `[Page X]`.",
        "- If excerpts omit an answer, say so clearly (or call `navigate_to` to inspect the relevant page).",
        "- Be concise and academic; skip filler.",
        toolLine,
        "",
        "EXCERPTS:",
        formatRagPassages(chunks, docTitle),
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildSummarySystemPrompt(
    focusMode: SummaryFocusMode,
    docTitle: string,
    flags?: SummaryPromptFlags,
): string {
    const rules = [
        "Summarize directly from the supplied PDF text and cite inline as `[Page X]`.",
        "Highlights, notes, and chats are strictly optional: if none are supplied, summarize the PDF text directly without mentioning missing highlights or asking for highlights.",
    ];

    if (flags?.hasNotes) {
        rules.push("Weave supplied user highlights/notes naturally where relevant.");
    }
    if (flags?.hasChats) {
        rules.push("Incorporate relevant points from supplied chat takeaways.");
    }
    if (flags?.hasCrops) {
        rules.push(
            "Embed provided figures on their own line as `![Concise description (Page X)](idb://crop-...)` without altering URIs.",
        );
    }
    if (flags?.webSearchEnabled) {
        rules.push(
            "Web search is enabled: cite external sources with URLs while keeping `[Page X]` for PDF claims.",
        );
    }
    rules.push(
        "Use fenced code blocks with language tags for algorithms/formulas. Return valid Markdown only—no preamble.",
    );

    return [
        `You are Foliet's scholarly synthesis assistant for "${docTitle}".`,
        MODE_RULES[focusMode],
        ...rules.map((r) => `- ${r}`),
    ].join("\n");
}

export function buildChapterSummaryPrompt(input: ChapterSummaryInput): string {
    const contextBlocks = formatSummaryContextBlocks(input);
    const hasText = input.chapterText.trim().length > 0;

    return [
        `Summarize "${input.chapterTitle}" (Pages ${input.startPage}–${input.endPage}) of "${input.docTitle}".`,
        `Start directly with: \`## ${input.chapterTitle}\``,
        "Use `###` subheadings, concise bullets, and `[Page X]` citations.",
        "",
        "PDF TEXT:",
        hasText
            ? input.chapterText.trim()
            : "(No extractable text found in this page range—state briefly that this page range appears scanned/empty.)",
        contextBlocks ? `\n${contextBlocks}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildModifySummaryPrompt(input: ModifySummaryInput): string {
    const contextBlocks = formatSummaryContextBlocks(input);
    const hasExisting = input.existingMarkdown.trim().length > 0;
    const chapterBlock = input.chapterContext?.text.trim()
        ? [
            `SOURCE TEXT (${input.chapterContext.title}, Pages ${input.chapterContext.startPage}–${input.chapterContext.endPage}):`,
            input.chapterContext.text.trim(),
        ].join("\n")
        : "";

    return [
        hasExisting
            ? "Update the EXISTING SUMMARY per the INSTRUCTION. Preserve unaffected sections, `[Page X]` citations, and `![...](idb://...)` links. Return the full updated Markdown only."
            : "Write a clean Markdown summary from the SOURCE TEXT per the INSTRUCTION, citing `[Page X]`. Return Markdown only.",
        "",
        `INSTRUCTION: ${input.instruction.trim()}`,
        hasExisting ? `\nEXISTING SUMMARY:\n${input.existingMarkdown.trim()}` : "",
        chapterBlock ? `\n${chapterBlock}` : "",
        contextBlocks ? `\n${contextBlocks}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

export function buildStructuredSummarizationPrompt(
    input: StructuredSummaryInput,
): string {
    const hasHighlightsOrNotes =
        input.highlights.length > 0 || input.notes.length > 0;
    const hasAttachedImages = input.crops.some((c) => Boolean(c.resolvedDataUrl));
    const figureRule =
        input.crops.length > 0
            ? `- Figures: ${hasAttachedImages ? "Inspect attached images carefully. " : ""}Embed via \`![description (Page X)](idb://crop-...)\` using only provided URIs.`
            : "- Do not invent image links.";

    const contextBlocks = formatSummaryContextBlocks(input);

    return [
        `Synthesize a structured Markdown summary for "${input.docTitle}".`,
        MODE_RULES[input.focusMode],
        STRUCTURED_OUTLINES[input.focusMode],
        "",
        "RULES:",
        hasHighlightsOrNotes
            ? "- Synthesize the document text while giving priority to the supplied user highlights and notes."
            : "- Synthesize directly from the supplied document excerpts below. Do not mention missing highlights or ask the user to highlight text.",
        "- Cite pages inline as `[Page X]`.",
        figureRule,
        "- Return valid Markdown only—no preamble.",
        contextBlocks ? `\n${contextBlocks}` : "",
        input.fallbackExcerpt?.trim()
            ? `\nDOCUMENT EXCERPTS:\n${input.fallbackExcerpt.trim()}`
            : "",
    ]
        .filter(Boolean)
        .join("\n");
}
