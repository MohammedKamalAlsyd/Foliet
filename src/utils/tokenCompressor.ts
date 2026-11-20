/**
 * Foliet - Deterministic Prompt & Document Token Compressor
 *
 * Strips PDF extraction bloat (repeated running headers/footers, hyphenated line
 * wraps, page-number noise, duplicate RAG overlap lines, trailing reference lists)
 * and enforces salience-preserving character budgets while keeping `[Page X]`
 * citation markers intact.
 */

import type { RagPromptContextItem } from "@/services/llm/types";
import type { ChatMessage } from "@/types/chat";

export interface CompressionStats {
    originalChars: number;
    compressedChars: number;
    savedChars: number;
    savedPercent: number;
    estimatedOriginalTokens: number;
    estimatedCompressedTokens: number;
}

export interface CompressedTextResult extends CompressionStats {
    text: string;
}

export interface DocumentCompressionOptions {
    /** Target maximum compressed characters. Defaults to 11_500 (~2,850 tokens). */
    maxChars?: number;
    /** Strip trailing References / Bibliography sections unless explicitly needed. */
    stripReferences?: boolean;
}

/** Fast BPE approximation (~4 chars per token for English / technical prose). */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

export function buildCompressionStats(
    originalChars: number,
    compressedChars: number,
): CompressionStats {
    const savedChars = Math.max(0, originalChars - compressedChars);
    const savedPercent =
        originalChars > 0 ? Math.round((savedChars / originalChars) * 100) : 0;
    return {
        originalChars,
        compressedChars,
        savedChars,
        savedPercent,
        estimatedOriginalTokens: Math.ceil(originalChars / 4),
        estimatedCompressedTokens: Math.ceil(compressedChars / 4),
    };
}

const LIGATURE_MAP: Array<[RegExp, string]> = [
    [/\uFB00/g, "ff"],
    [/\uFB01/g, "fi"],
    [/\uFB02/g, "fl"],
    [/\uFB03/g, "ffi"],
    [/\uFB04/g, "ffl"],
    [/[\u00AD\u200B\u200C\u200D\uFEFF]/g, ""],
    [/\u00A0/g, " "],
];

const STANDALONE_PAGE_NUM_RE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|[-–—]?\s*\d{1,4}\s*[-–—]?)$/i;
const REFERENCES_HEADING_RE =
    /(?:^|\n)\s*(?:\d+\.?\s+)?(?:references|bibliography|works cited|literature cited)\s*(?:\n|$)/i;

function normalizePdfText(raw: string): string {
    let out = raw.replace(/\r\n?/g, "\n");
    for (const [pattern, replacement] of LIGATURE_MAP) {
        out = out.replace(pattern, replacement);
    }
    // Rejoin words broken across PDF lines by a trailing hyphen: "transfor-\nmers" -> "transformers"
    out = out.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
    // Collapse tabs and excessive horizontal whitespace
    out = out.replace(/[ \t]{2,}/g, " ");
    return out;
}

interface PageBlock {
    header: string;
    lines: string[];
}

function splitIntoPageBlocks(text: string): PageBlock[] {
    const pageMarkerRe = /^\[Page\s+\d+\]/m;
    if (!pageMarkerRe.test(text)) {
        return [{ header: "", lines: text.split("\n") }];
    }

    const parts = text.split(/(?=^\[Page\s+\d+\])/m).filter((p) => p.trim().length > 0);
    return parts.map((part) => {
        const match = /^(\[Page\s+\d+\])\s*([\s\S]*)$/.exec(part.trim());
        if (!match) {
            return { header: "", lines: part.split("\n") };
        }
        return {
            header: match[1],
            lines: match[2].split("\n"),
        };
    });
}

/**
 * Removes repeated running headers/footers that appear on >= 30% of pages
 * (when >= 3 pages are present) and standalone page-number artifact lines.
 */
function stripRepeatedPageNoise(blocks: PageBlock[]): PageBlock[] {
    if (blocks.length < 3) {
        return blocks.map((b) => ({
            header: b.header,
            lines: b.lines
                .map((l) => l.trim())
                .filter((l) => l.length > 0 && !STANDALONE_PAGE_NUM_RE.test(l)),
        }));
    }

    const lineFreq = new Map<string, number>();
    for (const block of blocks) {
        const seenInPage = new Set<string>();
        const cleaned = block.lines.map((l) => l.trim()).filter(Boolean);
        // Running headers/footers live in the first 2 or last 2 lines of each page
        const candidates = [...cleaned.slice(0, 2), ...cleaned.slice(-2)];
        for (const line of candidates) {
            if (line.length > 110) continue;
            const norm = line.replace(/\d+/g, "#").toLowerCase();
            if (!seenInPage.has(norm)) {
                seenInPage.add(norm);
                lineFreq.set(norm, (lineFreq.get(norm) ?? 0) + 1);
            }
        }
    }

    const threshold = Math.max(2, Math.ceil(blocks.length * 0.5));
    const repeatedNorms = new Set<string>();
    for (const [norm, count] of lineFreq.entries()) {
        if (count >= threshold) repeatedNorms.add(norm);
    }

    return blocks.map((block) => ({
        header: block.header,
        lines: block.lines
            .map((l) => l.trim())
            .filter((line) => {
                if (!line) return false;
                if (STANDALONE_PAGE_NUM_RE.test(line)) return false;
                if (line.length <= 110) {
                    const norm = line.replace(/\d+/g, "#").toLowerCase();
                    if (repeatedNorms.has(norm)) return false;
                }
                return true;
            }),
    }));
}

/** Reflows fragmented single-line PDF wraps into compact paragraphs. */
function reflowCompactParagraphs(lines: string[]): string {
    const paragraphs: string[] = [];
    let current = "";

    for (const line of lines) {
        const isHeadingOrBullet =
            /^(?:#{1,6}\s|[-*•▪]\s|\d+[.)]\s|(?:Figure|Fig\.|Table|Algorithm|Theorem|Lemma|Definition)\s+\d)/i.test(
                line,
            );

        if (!current) {
            current = line;
            continue;
        }

        if (isHeadingOrBullet || /[.!?:;]$/.test(current) && current.length > 160) {
            paragraphs.push(current);
            current = line;
        } else {
            current = `${current} ${line}`;
        }
    }

    if (current) paragraphs.push(current);
    return paragraphs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Scores a sentence for extractive compression when a document exceeds `maxChars`.
 * Favors empirical numbers, definitions, thesis markers, and equations over filler.
 */
function scoreSentenceSalience(sentence: string, index: number, total: number): number {
    let score = 0;
    if (index === 0 || index === total - 1) score += 3;
    if (/\d+(?:\.\d+)?%|\b\d{2,}\b/.test(sentence)) score += 2.2;
    if (
        /\b(?:propose|demonstrate|result|finding|conclude|method|algorithm|architecture|theorem|equation|outperform|significantly|however|therefore|key|core|novel|limit)\b/i.test(
            sentence,
        )
    ) {
        score += 2.0;
    }
    if (/^[A-Z0-9][^.]{0,60}:/.test(sentence)) score += 1.5;
    if (sentence.length < 35) score -= 1.2;
    if (sentence.length > 420) score -= 0.8;
    return score;
}

function fitTextToBudget(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;

    const blocks = splitIntoPageBlocks(text);
    if (blocks.length > 1) {
        const perBlockBudget = Math.max(220, Math.floor((maxChars - blocks.length * 14) / blocks.length));
        const compressedBlocks: string[] = [];
        let used = 0;

        for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const remainingBlocks = blocks.length - i;
            const dynamicBudget = Math.max(
                200,
                Math.min(perBlockBudget * 1.35, Math.floor((maxChars - used) / remainingBlocks)),
            );
            const body = b.lines.join("\n").trim();
            if (!body) continue;

            const fittedBody = selectSalientSentences(body, Math.floor(dynamicBudget - b.header.length - 4));
            const chunk = b.header ? `${b.header} ${fittedBody}` : fittedBody;
            if (used + chunk.length + 2 > maxChars && compressedBlocks.length > 0) {
                break;
            }
            compressedBlocks.push(chunk);
            used += chunk.length + 2;
        }

        return compressedBlocks.join("\n\n").slice(0, maxChars).trim();
    }

    return selectSalientSentences(text, maxChars);
}

function selectSalientSentences(body: string, budget: number): string {
    if (body.length <= budget) return body;

    const sentences = body
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

    if (sentences.length <= 2) {
        return `${body.slice(0, Math.max(80, budget - 1)).trimEnd()}…`;
    }

    const scored = sentences.map((s, idx) => ({
        idx,
        text: s,
        score: scoreSentenceSalience(s, idx, sentences.length),
    }));

    const ranked = [...scored].sort((a, b) => b.score - a.score);
    const chosenIndices = new Set<number>();
    let totalLen = 0;

    for (const item of ranked) {
        if (totalLen + item.text.length + 1 <= budget) {
            chosenIndices.add(item.idx);
            totalLen += item.text.length + 1;
        }
    }

    if (chosenIndices.size === 0) {
        return `${body.slice(0, Math.max(80, budget - 1)).trimEnd()}…`;
    }

    return sentences
        .filter((_, idx) => chosenIndices.has(idx))
        .join(" ")
        .trim();
}

/**
 * Compresses raw PDF / chapter text while preserving `[Page X]` markers and key facts.
 */
export function compressDocumentText(
    rawText: string,
    options?: DocumentCompressionOptions,
): CompressedTextResult {
    const originalChars = rawText.length;
    if (!rawText.trim()) {
        return { text: "", ...buildCompressionStats(0, 0) };
    }

    const maxChars = options?.maxChars ?? 11_500;
    const stripReferences = options?.stripReferences ?? true;

    const normalized = normalizePdfText(rawText);

    // 1. Strip repeated running headers/footers across all pages BEFORE reference trimming
    const cleanedBlocks = stripRepeatedPageNoise(splitIntoPageBlocks(normalized));

    // 2. Strip trailing References / Bibliography on line-preserved text before paragraph reflow
    let joinedWithLines = cleanedBlocks
        .map((b) => (b.header ? `${b.header}\n${b.lines.join("\n")}` : b.lines.join("\n")))
        .filter((s) => s.trim().length > 0)
        .join("\n\n");

    if (stripReferences) {
        const refMatch = REFERENCES_HEADING_RE.exec(joinedWithLines);
        if (refMatch && refMatch.index > joinedWithLines.length * 0.45) {
            joinedWithLines = `${joinedWithLines.slice(0, refMatch.index).trimEnd()}\n[References omitted]`;
        }
    }

    // 3. Reflow fragmented PDF line wraps into compact paragraphs per page
    let compacted = splitIntoPageBlocks(joinedWithLines)
        .map((b) => {
            const body = reflowCompactParagraphs(
                b.lines.map((l) => l.trim()).filter(Boolean),
            );
            if (!body) return "";
            return b.header ? `${b.header} ${body}` : body;
        })
        .filter(Boolean)
        .join("\n\n");

    compacted = fitTextToBudget(compacted, maxChars);

    return {
        text: compacted,
        ...buildCompressionStats(originalChars, compacted.length),
    };
}

/**
 * Deduplicates overlapping lines across adjacent RAG chunks and uses compact `[Page X]`
 * labels to minimize prompt token overhead.
 */
export function compressRagPassages(
    chunks: RagPromptContextItem[],
    defaultDocTitle?: string,
    maxTotalChars = 7_500,
): string {
    if (chunks.length === 0) return "(No passages retrieved.)";

    const seenLines = new Set<string>();
    const multiDoc =
        new Set(chunks.map((c) => c.docTitle || defaultDocTitle || "")).size > 1;

    const blocks: string[] = [];
    let used = 0;

    for (const chunk of chunks) {
        const normalized = normalizePdfText(chunk.text);
        const dedupedLines = normalized
            .split("\n")
            .map((l) => l.trim())
            .filter((line) => {
                if (!line || STANDALONE_PAGE_NUM_RE.test(line)) return false;
                const key = line.toLowerCase();
                if (line.length > 24 && seenLines.has(key)) return false;
                seenLines.add(key);
                return true;
            });

        const body = reflowCompactParagraphs(dedupedLines);
        if (!body) continue;

        const label =
            multiDoc && chunk.docTitle
                ? `[${chunk.docTitle}, Page ${chunk.pageNumber}]`
                : `[Page ${chunk.pageNumber}]`;
        const entry = `${label} ${body}`;

        if (used + entry.length > maxTotalChars && blocks.length > 0) {
            const remaining = maxTotalChars - used;
            if (remaining > 180) {
                blocks.push(`${entry.slice(0, remaining - 1).trimEnd()}…`);
            }
            break;
        }
        blocks.push(entry);
        used += entry.length + 2;
    }

    return blocks.join("\n\n") || "(No passages retrieved.)";
}

/**
 * Compacts older chat turns for wire transmission while keeping the most recent
 * turns verbatim. Original messages in SQLite remain untouched.
 */
export function compressChatHistory(
    messages: ChatMessage[],
    options?: { maxRecentMessages?: number; maxOldChars?: number; maxTotalMessages?: number },
): ChatMessage[] {
    const maxRecent = options?.maxRecentMessages ?? 6;
    const maxOldChars = options?.maxOldChars ?? 320;
    const maxTotal = options?.maxTotalMessages ?? 16;

    const window = messages.length > maxTotal ? messages.slice(-maxTotal) : messages;
    const cutoff = Math.max(0, window.length - maxRecent);

    return window.map((msg, idx) => {
        if (idx >= cutoff) return msg;
        const clean = msg.content.replace(/\s+/g, " ").trim();
        if (clean.length <= maxOldChars) return msg;
        return {
            ...msg,
            content: `${clean.slice(0, maxOldChars - 1).trimEnd()}…`,
        };
    });
}
