/**
 * Foliet - Shared Citation Jump & Passage Spotlighting Helper
 *
 * Centralizes page navigation and passage-level spotlighting for both
 * AiChatPanel (inline `[Page X]` links and `Sources` chips) and
 * SummaryDocsEditor (`[Page X]` / `(Page X)` decorations).
 */

import { RagService } from "@/services/rag";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import type { Rect } from "@/types/common";
import type { DocumentChunk } from "@/types/embedding";
import {
    getPageRagChunks,
    resolveDomTextRects,
    resolvePassageRects,
    waitForRenderedPage,
} from "@/utils/pdfDom";

export interface CitationSpotlightOptions {
    pageNumber: number;
    contextText?: string;
    snippet?: string;
    chunkId?: string;
    docId?: string;
    docTitle?: string;
    rectSegments?: Rect[];
    onJumpToPage?: (page: number) => void;
}

const CITATION_TOKEN_STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "these",
    "those",
    "into",
    "over",
    "under",
    "between",
    "about",
    "which",
    "where",
    "when",
    "while",
    "such",
    "also",
    "more",
    "most",
    "only",
    "than",
    "then",
    "have",
    "has",
    "had",
    "were",
    "was",
    "are",
    "can",
    "could",
    "would",
    "should",
    "may",
    "might",
    "will",
    "been",
    "being",
    "page",
    "fig",
    "figure",
    "table",
    "section",
    "using",
    "used",
]);

const SENTENCE_ABBREVIATIONS = new Set([
    "fig",
    "figs",
    "eq",
    "eqs",
    "sec",
    "secs",
    "ch",
    "chs",
    "vol",
    "vols",
    "no",
    "nos",
    "pp",
    "p",
    "dr",
    "prof",
    "mr",
    "mrs",
    "ms",
    "jr",
    "sr",
    "al",
    "vs",
    "etc",
    "approx",
    "ref",
    "refs",
    "tbl",
    "tab",
    "alg",
    "est",
    "inc",
    "ltd",
    "eg",
    "ie",
]);

function isAbbreviationBeforePeriod(
    text: string,
    punctuationIdx: number,
): boolean {
    if (text[punctuationIdx] !== ".") return false;
    const before = text.slice(0, punctuationIdx);
    if (/(?:^|[\s(\["“])[A-Za-z]$/.test(before)) return true;
    if (/(?:e\.g|i\.e|u\.s|et\s+al)$/i.test(before)) return true;
    const wordMatch = /([A-Za-z]+)$/.exec(before);
    if (!wordMatch) return false;
    return SENTENCE_ABBREVIATIONS.has(wordMatch[1].toLowerCase());
}

function findLastSentenceStart(slice: string): number {
    let lastStart = 0;
    const newlineIdx = slice.lastIndexOf("\n");
    if (newlineIdx >= 0) {
        lastStart = newlineIdx + 1;
    }

    const boundaryRe = /[.!?]\s+(?=[A-Z0-9"“])/g;
    let match: RegExpExecArray | null;
    while ((match = boundaryRe.exec(slice)) !== null) {
        if (isAbbreviationBeforePeriod(slice, match.index)) continue;
        const candidateStart = match.index + match[0].length;
        if (candidateStart > lastStart) {
            lastStart = candidateStart;
        }
    }
    return lastStart;
}

function findFirstSentenceEnd(slice: string): number {
    const newlineIdx = slice.indexOf("\n");
    const limit = newlineIdx >= 0 ? newlineIdx : slice.length;
    const searchWindow = slice.slice(0, limit);

    const endRe = /[.!?](?=\s|$)/g;
    let match: RegExpExecArray | null;
    while ((match = endRe.exec(searchWindow)) !== null) {
        if (isAbbreviationBeforePeriod(searchWindow, match.index)) continue;
        return match.index + 1;
    }
    return limit;
}

function stripCitationsAndMarkdown(raw: string): string {
    return raw
        .replace(/\[(?:[^\]\n]*?,\s*)?Page\s+\d+\]|\(Page\s+\d+\)/gi, " ")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/[*_~>#]+/g, " ")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

function extractQuotedCandidates(raw: string): string[] {
    const matches: string[] = [];
    const quoteRe = /["“]([^"”\n]{15,280})["”]/g;
    let m: RegExpExecArray | null;
    while ((m = quoteRe.exec(raw)) !== null) {
        const cleaned = stripCitationsAndMarkdown(m[1]);
        if (cleaned.length >= 15) matches.push(cleaned);
    }
    return matches.sort((a, b) => b.length - a.length);
}

function tokenizeForOverlap(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !CITATION_TOKEN_STOPWORDS.has(w));
}

function pickBestMatchingChunk(
    pageChunks: DocumentChunk[],
    queryText: string,
): DocumentChunk | null {
    if (pageChunks.length === 0) return null;
    if (!queryText.trim()) return pageChunks[0];

    const queryTokens = tokenizeForOverlap(queryText);
    if (queryTokens.length === 0) return pageChunks[0];

    const uniqueQuery = new Set(queryTokens);
    const queryBigrams = new Set<string>();
    for (let i = 0; i < queryTokens.length - 1; i++) {
        queryBigrams.add(`${queryTokens[i]} ${queryTokens[i + 1]}`);
    }

    let bestChunk: DocumentChunk = pageChunks[0];
    let bestScore = -1;

    for (const chunk of pageChunks) {
        const chunkTokens = tokenizeForOverlap(chunk.text);
        if (chunkTokens.length === 0) continue;

        const chunkTokenSet = new Set(chunkTokens);
        let tokenHits = 0;
        for (const tok of uniqueQuery) {
            if (chunkTokenSet.has(tok)) tokenHits += 1;
        }

        let bigramHits = 0;
        if (queryBigrams.size > 0) {
            const chunkBigrams = new Set<string>();
            for (let i = 0; i < chunkTokens.length - 1; i++) {
                chunkBigrams.add(`${chunkTokens[i]} ${chunkTokens[i + 1]}`);
            }
            for (const bg of queryBigrams) {
                if (chunkBigrams.has(bg)) bigramHits += 1;
            }
        }

        const recall = tokenHits / uniqueQuery.size;
        const bigramRatio =
            queryBigrams.size > 0 ? bigramHits / queryBigrams.size : 0;
        const score = recall + bigramRatio * 0.45;

        if (score > bestScore) {
            bestScore = score;
            bestChunk = chunk;
        }
    }

    return bestChunk;
}

/**
 * Extracts the surrounding sentence/clause around a citation token inside a
 * block of text, handling multi-sentence paragraphs, trailing periods before
 * `[Page X]`, and common academic abbreviations (`Fig.`, `Eq.`, `et al.`).
 */
export function extractSentenceAroundOffset(
    blockText: string,
    matchStart: number,
    matchEnd: number,
): string {
    if (!blockText) return "";

    const searchFrom = Math.max(0, matchStart - 280);
    const beforeSlice = blockText.slice(searchFrom, matchStart);
    const trimmedBefore = beforeSlice.trimEnd();
    const lastBeforeChar = trimmedBefore[trimmedBefore.length - 1];
    const endsWithSentencePunctuation =
        (lastBeforeChar === "." ||
            lastBeforeChar === "!" ||
            lastBeforeChar === "?") &&
        !isAbbreviationBeforePeriod(trimmedBefore, trimmedBefore.length - 1);

    if (endsWithSentencePunctuation) {
        const bodyBeforeEnd = trimmedBefore.slice(0, -1);
        const startInSlice = findLastSentenceStart(bodyBeforeEnd);
        return stripCitationsAndMarkdown(
            trimmedBefore.slice(startInSlice),
        );
    }

    const startInSlice = findLastSentenceStart(beforeSlice);
    const startIdx = searchFrom + startInSlice;

    const searchUntil = Math.min(blockText.length, matchEnd + 180);
    const afterSlice = blockText.slice(matchEnd, searchUntil);
    const endInAfter = findFirstSentenceEnd(afterSlice);
    const endIdx = matchEnd + endInAfter;

    return stripCitationsAndMarkdown(blockText.slice(startIdx, endIdx));
}

export async function jumpAndSpotlightCitation(
    options: CitationSpotlightOptions,
): Promise<void> {
    const pageNumber = Math.max(1, Math.round(options.pageNumber));
    options.onJumpToPage?.(pageNumber);

    const activeDoc = useDocumentStore.getState().activeDoc;
    const targetDocId = options.docId ?? activeDoc?.id;
    const targetDocTitle = options.docTitle ?? activeDoc?.title ?? "Document";
    if (!targetDocId) return;

    const isCurrentDoc = !activeDoc || activeDoc.id === targetDocId;
    const cleanedContext = options.contextText
        ? stripCitationsAndMarkdown(options.contextText)
        : "";
    const snippetText = options.snippet?.trim() ?? "";

    // 1. Pre-resolved rectSegments (e.g. from RAG search or chat Sources chip)
    if (options.rectSegments && options.rectSegments.length > 0) {
        useRagStore.getState().setActiveRagHighlight({
            chunkId: options.chunkId ?? `citation-page-${pageNumber}`,
            docId: targetDocId,
            docTitle: targetDocTitle,
            pageNumber,
            text:
                snippetText ||
                cleanedContext ||
                `Citation on Page ${pageNumber}`,
            similarityScore: 1.0,
            rectSegments: options.rectSegments,
        });
        return;
    }

    // 2. Fetch document chunks for this page (if indexed)
    const pageChunks = await getPageRagChunks(targetDocId, pageNumber).catch(
        async () => {
            try {
                const allChunks = await RagService.getDocumentChunks(targetDocId);
                return allChunks.filter((c) => c.pageNumber === pageNumber);
            } catch {
                return [];
            }
        },
    );

    // 3. Exact chunkId lookup (e.g. persisted Sources chips without inline rectSegments)
    if (options.chunkId && pageChunks.length > 0) {
        const exactChunk = pageChunks.find((c) => c.chunkId === options.chunkId);
        if (exactChunk) {
            let rects = exactChunk.rectSegments;
            if ((!rects || rects.length === 0) && isCurrentDoc) {
                rects = await resolvePassageRects(
                    targetDocId,
                    pageNumber,
                    snippetText || exactChunk.text,
                    options.onJumpToPage,
                );
            }
            useRagStore.getState().setActiveRagHighlight({
                chunkId: exactChunk.chunkId,
                docId: targetDocId,
                docTitle: targetDocTitle,
                pageNumber,
                text: exactChunk.text,
                similarityScore: 1.0,
                rectSegments: rects && rects.length > 0 ? rects : undefined,
            });
            return;
        }
    }

    // 4. Direct DOM line resolution using verbatim snippet or quoted phrase in context
    if (isCurrentDoc && (snippetText || cleanedContext)) {
        await waitForRenderedPage(pageNumber, options.onJumpToPage, {
            timeoutMs: 850,
            requireCanvas: false,
            requireTextLayer: true,
        });

        const domCandidates: string[] = [];
        if (snippetText.length >= 12) domCandidates.push(snippetText);
        if (options.contextText) {
            domCandidates.push(...extractQuotedCandidates(options.contextText));
        }
        if (cleanedContext.length >= 18) {
            domCandidates.push(cleanedContext);
        }

        for (const candidate of domCandidates) {
            const rects = resolveDomTextRects(pageNumber, candidate);
            if (rects.length > 0) {
                useRagStore.getState().setActiveRagHighlight({
                    chunkId: options.chunkId ?? `citation-page-${pageNumber}`,
                    docId: targetDocId,
                    docTitle: targetDocTitle,
                    pageNumber,
                    text: candidate,
                    similarityScore: 1.0,
                    rectSegments: rects,
                });
                return;
            }
        }
    }

    // 5. Highest token-overlap chunk on the cited page (single passage, never page-wide merge)
    if (pageChunks.length > 0) {
        const bestChunk = pickBestMatchingChunk(
            pageChunks,
            snippetText || cleanedContext,
        );
        if (bestChunk) {
            let rects = bestChunk.rectSegments;
            if ((!rects || rects.length === 0) && isCurrentDoc) {
                rects = resolveDomTextRects(pageNumber, bestChunk.text);
            }
            useRagStore.getState().setActiveRagHighlight({
                chunkId: bestChunk.chunkId,
                docId: targetDocId,
                docTitle: targetDocTitle,
                pageNumber,
                text: bestChunk.text,
                similarityScore: 1.0,
                rectSegments: rects && rects.length > 0 ? rects : undefined,
            });
            return;
        }
    }

    // 6. Unindexed page fallback
    useRagStore.getState().setActiveRagHighlight({
        chunkId: options.chunkId ?? `citation-page-${pageNumber}`,
        docId: targetDocId,
        docTitle: targetDocTitle,
        pageNumber,
        text:
            snippetText ||
            cleanedContext ||
            `Citation on Page ${pageNumber}`,
        similarityScore: 1.0,
    });
}