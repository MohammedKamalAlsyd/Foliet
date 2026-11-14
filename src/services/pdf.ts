import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { BurnableAnnotation } from "@/types/annotations";
import type { PdfOpenResult } from "@/types/document";

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

    static async burnAndSave(
        filePath: string,
        annotations: BurnableAnnotation[],
        originalBuffer?: ArrayBuffer | null,
    ): Promise<void> {
        if (!filePath) throw new Error("Cannot save: no file path provided.");
        if (!(await exists(filePath))) {
            throw new Error(`Target file "${filePath}" no longer exists on disk.`);
        }

        const pdfBytes = originalBuffer
            ? new Uint8Array(originalBuffer)
            : await readFile(filePath);

        const resultBytes = await invoke<number[] | Uint8Array>("export_pdf", {
            pdfBytes,
            annotations,
        });

        await writeFile(filePath, new Uint8Array(resultBytes));
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
}