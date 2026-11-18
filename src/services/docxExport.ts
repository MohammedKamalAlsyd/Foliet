/**
 * Foliet - Markdown to Word (.docx) Exporter
 *
 * Converts Living Summary Markdown (headings, paragraphs, bold/italic/strike/code,
 * links, lists, blockquotes, tables, horizontal rules, `[Page X]` citations, and
 * `idb://crop-...` images) into a `.docx` file via `marked.lexer` + `docx`.
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
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
} from "docx";
import { marked, type Token, type Tokens } from "marked";
import { DocumentDatabase } from "@/services/storage/database";

type DocxImageType = "png" | "jpg" | "gif" | "bmp";
type DocxBlock = Paragraph | Table;

interface InlineStyle {
    bold?: boolean;
    italics?: boolean;
    strike?: boolean;
    color?: string;
    underline?: boolean;
}

const CITATION_REGEX = /(\[(?:[^\]\n]*?,\s*)?Page\s+\d+\]|\(Page\s+\d+\))/gi;

async function resolveImageDataUrl(src: string): Promise<string | null> {
    if (!src) return null;
    if (src.startsWith("data:")) return src;
    if (/^(idb:\/\/|db:\/\/|crop-)/.test(src)) {
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
            : rawExt === "gif" || rawExt === "bmp"
                ? rawExt
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

function splitCitationRuns(text: string, style: InlineStyle): TextRun[] {
    const runs: TextRun[] = [];
    CITATION_REGEX.lastIndex = 0;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = CITATION_REGEX.exec(text)) !== null) {
        if (match.index > lastIdx) {
            runs.push(
                new TextRun({
                    text: text.slice(lastIdx, match.index),
                    ...style,
                    underline: style.underline ? {} : undefined,
                }),
            );
        }
        runs.push(
            new TextRun({
                text: match[0],
                color: "2563EB",
                bold: true,
                size: 20,
            }),
        );
        lastIdx = CITATION_REGEX.lastIndex;
    }

    if (lastIdx < text.length) {
        runs.push(
            new TextRun({
                text: text.slice(lastIdx),
                ...style,
                underline: style.underline ? {} : undefined,
            }),
        );
    }

    return runs;
}

function tokensToRuns(tokens?: Token[], style: InlineStyle = {}): TextRun[] {
    if (!tokens || tokens.length === 0) return [];
    const runs: TextRun[] = [];

    for (const tok of tokens) {
        switch (tok.type) {
            case "strong":
                runs.push(
                    ...tokensToRuns((tok as Tokens.Strong).tokens, {
                        ...style,
                        bold: true,
                    }),
                );
                break;
            case "em":
                runs.push(
                    ...tokensToRuns((tok as Tokens.Em).tokens, {
                        ...style,
                        italics: true,
                    }),
                );
                break;
            case "del":
                runs.push(
                    ...tokensToRuns((tok as Tokens.Del).tokens, {
                        ...style,
                        strike: true,
                    }),
                );
                break;
            case "codespan":
                runs.push(
                    new TextRun({
                        text: (tok as Tokens.Codespan).text,
                        font: "Consolas",
                        size: 20,
                        shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
                    }),
                );
                break;
            case "link": {
                const link = tok as Tokens.Link;
                runs.push(
                    ...tokensToRuns(link.tokens, {
                        ...style,
                        color: "2563EB",
                        underline: true,
                    }),
                );
                break;
            }
            case "br":
                runs.push(new TextRun({ break: 1 }));
                break;
            case "image":
                runs.push(
                    new TextRun({
                        text: `[${(tok as Tokens.Image).text || "Figure"}]`,
                        italics: true,
                    }),
                );
                break;
            case "text":
            case "escape": {
                const t = tok as Tokens.Text;
                if ("tokens" in t && Array.isArray(t.tokens) && t.tokens.length > 0) {
                    runs.push(...tokensToRuns(t.tokens, style));
                } else {
                    runs.push(...splitCitationRuns(t.text, style));
                }
                break;
            }
            default:
                if (tok.raw) runs.push(...splitCitationRuns(tok.raw, style));
        }
    }

    return runs;
}

async function tokensToDocxBlocks(
    tokens: Token[],
    listLevel = 0,
): Promise<DocxBlock[]> {
    const blocks: DocxBlock[] = [];

    for (const tok of tokens) {
        switch (tok.type) {
            case "space":
                break;

            case "hr":
                blocks.push(
                    new Paragraph({
                        spacing: { before: 120, after: 120 },
                        border: {
                            bottom: {
                                color: "CBD5E1",
                                size: 6,
                                style: BorderStyle.SINGLE,
                                space: 4,
                            },
                        },
                    }),
                );
                break;

            case "heading": {
                const h = tok as Tokens.Heading;
                const heading =
                    h.depth === 1
                        ? HeadingLevel.HEADING_1
                        : h.depth === 2
                            ? HeadingLevel.HEADING_2
                            : h.depth === 3
                                ? HeadingLevel.HEADING_3
                                : HeadingLevel.HEADING_4;
                blocks.push(
                    new Paragraph({
                        heading,
                        spacing: { before: h.depth === 1 ? 260 : 200, after: 100 },
                        children: tokensToRuns(h.tokens),
                    }),
                );
                break;
            }

            case "code": {
                const code = tok as Tokens.Code;
                if (code.lang) {
                    blocks.push(
                        new Paragraph({
                            spacing: { before: 120, after: 40 },
                            shading: { type: ShadingType.CLEAR, fill: "E2E8F0" },
                            children: [
                                new TextRun({
                                    text: code.lang,
                                    font: "Consolas",
                                    size: 18,
                                    bold: true,
                                    color: "475569",
                                }),
                            ],
                        }),
                    );
                }
                for (const line of code.text.split("\n")) {
                    blocks.push(
                        new Paragraph({
                            spacing: { before: 0, after: 20 },
                            indent: { left: 240, right: 240 },
                            shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
                            children: [
                                new TextRun({
                                    text: line || " ",
                                    font: "Consolas",
                                    size: 19,
                                }),
                            ],
                        }),
                    );
                }
                break;
            }

            case "blockquote": {
                const bq = tok as Tokens.Blockquote;
                for (const child of bq.tokens) {
                    const children =
                        "tokens" in child && child.tokens
                            ? tokensToRuns(child.tokens)
                            : [new TextRun(child.raw.trim())];
                    blocks.push(
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
                            children,
                        }),
                    );
                }
                break;
            }

            case "list": {
                const list = tok as Tokens.List;
                const startNum = typeof list.start === "number" ? list.start : 1;
                for (let idx = 0; idx < list.items.length; idx++) {
                    const item = list.items[idx];
                    for (const child of item.tokens) {
                        if (child.type === "list") {
                            blocks.push(...(await tokensToDocxBlocks([child], listLevel + 1)));
                        } else if (child.type === "text" || child.type === "paragraph") {
                            const runs = tokensToRuns((child as Tokens.Text).tokens);
                            blocks.push(
                                new Paragraph(
                                    list.ordered
                                        ? {
                                            indent: {
                                                left: 360 * (listLevel + 1),
                                                hanging: 240,
                                            },
                                            spacing: { before: 40, after: 40 },
                                            children: [
                                                new TextRun({
                                                    text: `${startNum + idx}. `,
                                                    bold: true,
                                                }),
                                                ...runs,
                                            ],
                                        }
                                        : {
                                            bullet: { level: listLevel },
                                            spacing: { before: 40, after: 40 },
                                            children: runs,
                                        },
                                ),
                            );
                        } else {
                            blocks.push(...(await tokensToDocxBlocks([child], listLevel)));
                        }
                    }
                }
                break;
            }

            case "table": {
                const tbl = tok as Tokens.Table;
                const makeRow = (cells: Tokens.TableCell[], isHeader: boolean) =>
                    new TableRow({
                        children: cells.map(
                            (cell) =>
                                new TableCell({
                                    shading: isHeader
                                        ? { type: ShadingType.CLEAR, fill: "F1F5F9" }
                                        : undefined,
                                    children: [
                                        new Paragraph({
                                            spacing: { before: 40, after: 40 },
                                            children: tokensToRuns(
                                                cell.tokens,
                                                isHeader ? { bold: true } : {},
                                            ),
                                        }),
                                    ],
                                }),
                        ),
                    });
                blocks.push(
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        rows: [
                            makeRow(tbl.header, true),
                            ...tbl.rows.map((r) => makeRow(r, false)),
                        ],
                    }),
                );
                break;
            }

            case "paragraph": {
                const p = tok as Tokens.Paragraph;
                const img =
                    p.tokens?.length === 1 && p.tokens[0].type === "image"
                        ? (p.tokens[0] as Tokens.Image)
                        : null;
                if (img) {
                    const dataUrl = await resolveImageDataUrl(img.href);
                    const decoded = dataUrl ? decodeBase64DataUrl(dataUrl) : null;
                    if (dataUrl && decoded) {
                        const dims = await getScaledImageDimensions(dataUrl);
                        blocks.push(
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
                        if (img.text.trim()) {
                            blocks.push(
                                new Paragraph({
                                    alignment: AlignmentType.CENTER,
                                    spacing: { before: 0, after: 160 },
                                    children: [
                                        new TextRun({
                                            text: img.text.trim(),
                                            italics: true,
                                            size: 19,
                                            color: "64748B",
                                        }),
                                    ],
                                }),
                            );
                        }
                        break;
                    }
                }
                blocks.push(
                    new Paragraph({
                        spacing: { before: 60, after: 100 },
                        children: tokensToRuns(p.tokens),
                    }),
                );
                break;
            }

            default:
                if ("text" in tok && typeof tok.text === "string" && tok.text.trim()) {
                    blocks.push(
                        new Paragraph({
                            spacing: { before: 60, after: 100 },
                            children: splitCitationRuns(tok.text.trim(), {}),
                        }),
                    );
                }
        }
    }

    return blocks;
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

    const children = await tokensToDocxBlocks(marked.lexer(markdown));
    const doc = new Document({
        creator: "Foliet",
        title: docTitle,
        sections: [{ children }],
    });

    const blob = await Packer.toBlob(doc);
    await writeFile(targetPath, new Uint8Array(await blob.arrayBuffer()));
    return true;
}