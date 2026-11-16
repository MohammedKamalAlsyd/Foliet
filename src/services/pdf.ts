import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { BurnableAnnotation } from "@/types/annotations";
import type { PdfOpenResult, PdfOutlineNode } from "@/types/document";

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
}