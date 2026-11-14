import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { BurnableAnnotation } from "@/types/annotations";
import type { PdfOpenResult, PdfOutlineNode } from "@/types/document";

export const PDF_DOCUMENT_OPTIONS = {
    rangeChunkSize: 131_072,
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
        return invoke<PdfOpenResult["extractedAnnotations"]>("extract_pdf_annotations", {
            filePath,
        });
    }

    private static async burnBytes(
        sourcePath: string,
        annotations: BurnableAnnotation[],
        originalBuffer?: ArrayBuffer | null,
    ): Promise<Uint8Array> {
        if (!sourcePath) throw new Error("No file path provided.");
        if (!originalBuffer && !(await exists(sourcePath))) {
            throw new Error(`Target file "${sourcePath}" no longer exists on disk.`);
        }

        const pdfBytes = originalBuffer
            ? new Uint8Array(originalBuffer)
            : await readFile(sourcePath);

        const resultBytes = await invoke<number[] | Uint8Array>("export_pdf", {
            pdfBytes,
            annotations,
        });
        return new Uint8Array(resultBytes);
    }

    static async burnAndSave(
        filePath: string,
        annotations: BurnableAnnotation[],
        originalBuffer?: ArrayBuffer | null,
    ): Promise<void> {
        const bytes = await this.burnBytes(filePath, annotations, originalBuffer);
        await writeFile(filePath, bytes);
    }

    /** Exports an annotated copy to a user-selected path via the `export_pdf` IPC command. */
    static async exportDocument(
        sourcePath: string,
        annotations: BurnableAnnotation[],
        defaultName = "annotated.pdf",
        originalBuffer?: ArrayBuffer | null,
    ): Promise<string | null> {
        const targetPath = await save({
            defaultPath: defaultName.endsWith(".pdf") ? defaultName : `${defaultName}.pdf`,
            filters: [{ name: "PDF Documents", extensions: ["pdf"] }],
        });
        if (!targetPath) return null;

        const bytes = await this.burnBytes(sourcePath, annotations, originalBuffer);
        await writeFile(targetPath, bytes);
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

        const walk = async (items: any[], level: number, prefix: string): Promise<PdfOutlineNode[]> => {
            const nodes: PdfOutlineNode[] = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                let pageNumber = 1;
                try {
                    let dest = item.dest;
                    if (typeof dest === "string") dest = await pdfProxy.getDestination(dest);
                    if (Array.isArray(dest) && dest[0]) {
                        pageNumber = (await pdfProxy.getPageIndex(dest[0])) + 1;
                    }
                } catch {
                    // Fallback to page 1 if destination cannot be resolved
                }
                const id = `${prefix}-${i}`;
                nodes.push({
                    id,
                    title: item.title || "Untitled",
                    pageNumber,
                    level,
                    dest: item.dest,
                    children: item.items?.length ? await walk(item.items, level + 1, id) : undefined,
                });
            }
            return nodes;
        };

        return walk(raw, 0, "outline");
    }

    static async extractPageLabels(pdfProxy: any): Promise<string[] | null> {
        const labels = await pdfProxy?.getPageLabels?.();
        return Array.isArray(labels) && labels.length > 0 ? labels : null;
    }
}