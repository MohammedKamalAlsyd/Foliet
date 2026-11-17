/**
 * Foliet - Markdown to Word (.docx) Exporter
 *
 * Converts Living Summary Markdown (headings #–###, paragraphs, bold/italic/inline code,
 * bullet/ordered lists, blockquotes, fenced code blocks, and `idb://crop-...` images)
 * into a `.docx` file saved via Tauri dialog + fs.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
    AlignmentType,
    BorderStyle,
    Document,
    HeadingLevel,
    ImageRun,
    Packer,
    Paragraph,
    ShadingType,
    TextRun,
} from "docx";
import { DocumentDatabase } from "@/services/storage/database";

type DocxImageType = "png" | "jpg" | "gif" | "bmp";

async function resolveImageDataUrl(src: string): Promise<string | null> {
    if (!src) return null;
    if (src.startsWith("data:")) return src;
    if (
        src.startsWith("idb://") ||
        src.startsWith("db://") ||
        src.startsWith("crop-")
    ) {
        return DocumentDatabase.getFigureCrop(src);
    }
    return null;
}

function decodeBase64DataUrl(
    dataUrl: string,
): { bytes: Uint8Array; type: DocxImageType } | null {
    const match = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/s.exec(dataUrl);
    if (!match) return null;

    const rawExt = match[1].toLowerCase();
    const type: DocxImageType =
        rawExt === "jpeg" || rawExt === "jpg"
            ? "jpg"
            : rawExt === "gif"
                ? "gif"
                : rawExt === "bmp"
                    ? "bmp"
                    : "png";

    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, type };
}

function getScaledImageDimensions(
    dataUrl: string,
    maxWidth = 540,
    maxHeight = 420,
): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const natW = img.naturalWidth || 480;
            const natH = img.naturalHeight || 300;
            const scale = Math.min(1, maxWidth / natW, maxHeight / natH);
            resolve({
                width: Math.max(40, Math.round(natW * scale)),
                height: Math.max(40, Math.round(natH * scale)),
            });
        };
        img.onerror = () => resolve({ width: 460, height: 280 });
        img.src = dataUrl;
    });
}

function parseInlineRuns(text: string): TextRun[] {
    const runs: TextRun[] = [];
    const tokenRegex =
        /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[(?:[^\]\n]*?,\s*)?Page\s+\d+\]|\(Page\s+\d+\))/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            runs.push(new TextRun(text.slice(lastIndex, match.index)));
        }

        const token = match[0];
        if (token.startsWith("**") && token.endsWith("**")) {
            runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
        } else if (token.startsWith("*") && token.endsWith("*")) {
            runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
        } else if (token.startsWith("`") && token.endsWith("`")) {
            runs.push(
                new TextRun({
                    text: token.slice(1, -1),
                    font: "Consolas",
                    size: 20,
                    shading: {
                        type: ShadingType.CLEAR,
                        fill: "F1F5F9",
                    },
                }),
            );
        } else {
            // [Page X] or (Page X) citation
            runs.push(
                new TextRun({
                    text: token,
                    color: "2563EB",
                    bold: true,
                    size: 20,
                }),
            );
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
        runs.push(new TextRun(text.slice(lastIndex)));
    }

    return runs.length > 0 ? runs : [new TextRun(text)];
}

async function markdownToDocxParagraphs(markdown: string): Promise<Paragraph[]> {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const paragraphs: Paragraph[] = [];

    let inCodeBlock = false;
    let codeLang = "";
    let codeLines: string[] = [];

    const flushCodeBlock = () => {
        if (codeLines.length === 0) return;
        if (codeLang) {
            paragraphs.push(
                new Paragraph({
                    spacing: { before: 120, after: 40 },
                    shading: { type: ShadingType.CLEAR, fill: "E2E8F0" },
                    children: [
                        new TextRun({
                            text: codeLang,
                            font: "Consolas",
                            size: 18,
                            bold: true,
                            color: "475569",
                        }),
                    ],
                }),
            );
        }
        for (const cl of codeLines) {
            paragraphs.push(
                new Paragraph({
                    spacing: { before: 0, after: 20 },
                    indent: { left: 240, right: 240 },
                    shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
                    children: [
                        new TextRun({
                            text: cl || " ",
                            font: "Consolas",
                            size: 19,
                        }),
                    ],
                }),
            );
        }
        codeLines = [];
        codeLang = "";
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith("```")) {
            if (inCodeBlock) {
                flushCodeBlock();
                inCodeBlock = false;
            } else {
                inCodeBlock = true;
                codeLang = trimmed.slice(3).trim();
                codeLines = [];
            }
            continue;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            continue;
        }

        if (!trimmed) {
            continue;
        }

        // Standalone image line: ![alt](src)
        const imgMatch = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed);
        if (imgMatch) {
            const alt = imgMatch[1].trim();
            const rawSrc = imgMatch[2].trim();
            const dataUrl = await resolveImageDataUrl(rawSrc);
            if (dataUrl) {
                const decoded = decodeBase64DataUrl(dataUrl);
                if (decoded) {
                    const dims = await getScaledImageDimensions(dataUrl);
                    paragraphs.push(
                        new Paragraph({
                            alignment: AlignmentType.CENTER,
                            spacing: { before: 160, after: 60 },
                            children: [
                                new ImageRun({
                                    type: decoded.type,
                                    data: decoded.bytes,
                                    transformation: dims,
                                }),
                            ],
                        }),
                    );
                    if (alt) {
                        paragraphs.push(
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                spacing: { before: 0, after: 160 },
                                children: [
                                    new TextRun({
                                        text: alt,
                                        italics: true,
                                        size: 19,
                                        color: "64748B",
                                    }),
                                ],
                            }),
                        );
                    }
                    continue;
                }
            }
        }

        // Headings #..####
        const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const headingEnum =
                level === 1
                    ? HeadingLevel.HEADING_1
                    : level === 2
                        ? HeadingLevel.HEADING_2
                        : level === 3
                            ? HeadingLevel.HEADING_3
                            : HeadingLevel.HEADING_4;
            paragraphs.push(
                new Paragraph({
                    heading: headingEnum,
                    spacing: { before: level === 1 ? 260 : 200, after: 100 },
                    children: parseInlineRuns(headingMatch[2].trim()),
                }),
            );
            continue;
        }

        // Blockquote
        if (trimmed.startsWith("> ")) {
            paragraphs.push(
                new Paragraph({
                    indent: { left: 360 },
                    spacing: { before: 80, after: 80 },
                    border: {
                        left: {
                            color: "94A3B8",
                            size: 18,
                            style: BorderStyle.SINGLE,
                            space: 10,
                        },
                    },
                    shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
                    children: parseInlineRuns(trimmed.slice(2).trim()),
                }),
            );
            continue;
        }

        // Bullet list
        const bulletMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
        if (bulletMatch) {
            paragraphs.push(
                new Paragraph({
                    bullet: { level: 0 },
                    spacing: { before: 40, after: 40 },
                    children: parseInlineRuns(bulletMatch[1]),
                }),
            );
            continue;
        }

        // Ordered list
        const orderedMatch = /^(\d+)\.\s+(.+)$/.exec(trimmed);
        if (orderedMatch) {
            paragraphs.push(
                new Paragraph({
                    indent: { left: 360, hanging: 240 },
                    spacing: { before: 40, after: 40 },
                    children: [
                        new TextRun({ text: `${orderedMatch[1]}. `, bold: true }),
                        ...parseInlineRuns(orderedMatch[2]),
                    ],
                }),
            );
            continue;
        }

        // Regular paragraph
        paragraphs.push(
            new Paragraph({
                spacing: { before: 60, after: 100 },
                children: parseInlineRuns(trimmed),
            }),
        );
    }

    if (inCodeBlock) {
        flushCodeBlock();
    }

    return paragraphs;
}

export async function exportSummaryToDocx(
    markdown: string,
    docTitle: string,
): Promise<boolean> {
    const safeName = docTitle
        .replace(/\.pdf$/i, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "");

    const targetPath = await save({
        defaultPath: `${safeName || "summary"}-notes.docx`,
        filters: [{ name: "Word Document", extensions: ["docx"] }],
    });
    if (!targetPath) return false;

    const children = await markdownToDocxParagraphs(markdown);
    const doc = new Document({
        creator: "Foliet",
        title: docTitle,
        sections: [{ children }],
    });

    const blob = await Packer.toBlob(doc);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(targetPath, bytes);
    return true;
}
