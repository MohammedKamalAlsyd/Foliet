import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { BurnableAnnotation } from "@/types/annotations";
import type { PdfChapter, PdfOpenResult, PdfOutlineNode } from "@/types/document";

export const PDF_DOCUMENT_OPTIONS = {
    rangeChunkSize: 1_048_576,
    disableAutoFetch: false,
    disableStream: false,
    isEvalSupported: false,
} as const;

export class PdfService {
    static async pickFile(): Promise<PdfOpenResult | null> {
        const path = await open({
            multiple: false,
            directory: false,
            filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
        });
        return typeof path === "string" ? this.openDocument(path) : null;
    }

    /** Fast metadata open: hashes/checks document without sending full PDF bytes over IPC. */
    static openDocument(filePath: string): Promise<PdfOpenResult> {
        if (!filePath) throw new Error("No file path specified.");
        return invoke<PdfOpenResult>("open_pdf_document", { filePath });
    }

    /** Lazily extracts embedded PDF annotations in background after viewer opens. */
    static extractAnnotations(filePath: string) {
        return invoke<PdfOpenResult["extractedAnnotations"]>(
            "extract_pdf_annotations",
            { filePath },
        );
    }

    static async burnAndSave(
        filePath: string,
        annotations: BurnableAnnotation[],
        _originalBuffer?: ArrayBuffer | null,
    ): Promise<void> {
        if (!filePath) throw new Error("No file path provided.");
        await invoke("export_pdf", {
            sourcePath: filePath,
            targetPath: filePath,
            annotations,
        });
    }

    /** Exports an annotated copy to a user-selected path via the `export_pdf` IPC command. */
    static async exportDocument(
        sourcePath: string,
        annotations: BurnableAnnotation[],
        defaultName = "annotated.pdf",
        _originalBuffer?: ArrayBuffer | null,
    ): Promise<string | null> {
        if (!sourcePath) throw new Error("No file path provided.");
        const targetPath = await save({
            defaultPath: defaultName.endsWith(".pdf")
                ? defaultName
                : `${defaultName}.pdf`,
            filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
        });
        if (!targetPath) return null;

        await invoke("export_pdf", {
            sourcePath,
            targetPath,
            annotations,
        });
        return targetPath;
    }

    static async revealInFolder(filePath?: string): Promise<boolean> {
        if (!filePath) return false;
        try {
            await revealItemInDir(filePath);
            return true;
        } catch {
            return false;
        }
    }

    static async extractOutline(pdfProxy: any): Promise<PdfOutlineNode[]> {
        const raw = await pdfProxy?.getOutline?.();
        if (!Array.isArray(raw)) return [];

        const walk = (
            items: any[],
            level: number,
            prefix: string,
        ): Promise<PdfOutlineNode[]> =>
            Promise.all(
                items.map(async (item, i) => {
                    let pageNumber = 1;
                    try {
                        const dest =
                            typeof item.dest === "string"
                                ? await pdfProxy.getDestination(item.dest)
                                : item.dest;
                        if (Array.isArray(dest) && dest[0]) {
                            pageNumber = (await pdfProxy.getPageIndex(dest[0])) + 1;
                        }
                    } catch {
                        // Fallback to page 1 if destination cannot be resolved
                    }
                    const id = `${prefix}-${i}`;
                    return {
                        id,
                        title: item.title || "Untitled",
                        pageNumber,
                        level,
                        dest: item.dest,
                        children: item.items?.length
                            ? await walk(item.items, level + 1, id)
                            : undefined,
                    };
                }),
            );

        return walk(raw, 0, "outline");
    }

    static async extractPageLabels(pdfProxy: any): Promise<string[] | null> {
        const labels = await pdfProxy?.getPageLabels?.();
        return Array.isArray(labels) && labels.length > 0 ? labels : null;
    }

    /**
     * Converts a PDF outline into contiguous `[startPage, endPage]` chapters.
     * Falls back to fixed 12-page sections when no outline is embedded.
     */
    static buildChapters(
        outline: PdfOutlineNode[],
        totalPages: number,
    ): PdfChapter[] {
        const maxPages = Math.max(1, totalPages || 1);

        let candidates = outline.filter((n) => n.title.trim().length > 0);
        // Unwrap single root book node when chapters live one level deeper
        if (candidates.length === 1 && candidates[0].children?.length) {
            candidates = candidates[0].children.filter((n) => n.title.trim().length > 0);
        }
        // Unwrap coarse "Part I / Part II" containers if they have chapter children
        if (
            candidates.length > 0 &&
            candidates.length <= 3 &&
            candidates.every((c) => Boolean(c.children?.length))
        ) {
            candidates = candidates.flatMap((c) =>
                (c.children ?? []).filter((ch) => ch.title.trim().length > 0),
            );
        }

        if (candidates.length > 0) {
            const sorted = [...candidates]
                .map((n, idx) => ({
                    id: n.id || `chapter-${idx + 1}`,
                    title: n.title.trim(),
                    startPage: Math.min(maxPages, Math.max(1, n.pageNumber || 1)),
                    level: n.level,
                }))
                .sort((a, b) => a.startPage - b.startPage);

            const chapters: PdfChapter[] = [];
            if (sorted[0].startPage > 2) {
                chapters.push({
                    id: "chapter-front-matter",
                    title: "Introduction & Front Matter",
                    startPage: 1,
                    endPage: sorted[0].startPage - 1,
                    level: 0,
                });
            }

            for (let i = 0; i < sorted.length; i++) {
                const curr = sorted[i];
                const next = sorted[i + 1];
                const endPage = next
                    ? Math.max(curr.startPage, next.startPage - 1)
                    : maxPages;

                chapters.push({
                    id: curr.id,
                    title: curr.title,
                    startPage: curr.startPage,
                    endPage: Math.min(maxPages, endPage),
                    level: curr.level,
                });
            }
            return chapters;
        }

        if (maxPages <= 15) {
            return [
                {
                    id: "section-1",
                    title: `Full Document (Pages 1–${maxPages})`,
                    startPage: 1,
                    endPage: maxPages,
                    level: 0,
                },
            ];
        }

        const sectionSize = 12;
        const chapters: PdfChapter[] = [];
        for (let start = 1, idx = 1; start <= maxPages; start += sectionSize, idx++) {
            const end = Math.min(maxPages, start + sectionSize - 1);
            chapters.push({
                id: `section-${idx}`,
                title: `Section ${idx} (Pages ${start}–${end})`,
                startPage: start,
                endPage: end,
                level: 0,
            });
        }
        return chapters;
    }

    /**
     * Extracts plain text directly from `pdfProxy` across `[startPage, endPage]`
     * as a fallback when the PDF has not been RAG-indexed yet.
     */
    static async extractPageRangeText(
        pdfProxy: any,
        startPage: number,
        endPage: number,
        maxChars = 18_000,
    ): Promise<string> {
        if (!pdfProxy?.getPage) return "";
        const numPages = Math.max(1, Number(pdfProxy.numPages) || endPage);
        const from = Math.min(numPages, Math.max(1, startPage));
        const to = Math.min(numPages, Math.max(from, endPage));

        const parts: string[] = [];
        let totalLen = 0;

        for (let p = from; p <= to; p++) {
            try {
                const page = await pdfProxy.getPage(p);
                const content = await page.getTextContent();
                const pageText = (content?.items ?? [])
                    .map((it: any) => (typeof it?.str === "string" ? it.str : ""))
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();
                if (!pageText) continue;

                const block = `[Page ${p}]\n${pageText}`;
                if (totalLen + block.length > maxChars) {
                    const remaining = Math.max(0, maxChars - totalLen);
                    if (remaining > 120) {
                        parts.push(block.slice(0, remaining));
                    }
                    break;
                }
                parts.push(block);
                totalLen += block.length + 2;
            } catch {
                // Skip unreadable page
            }
        }

        return parts.join("\n\n");
    }
}