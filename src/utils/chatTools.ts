import {
    captureFigureCropFromPage,
    insertFigureIntoSummary,
} from "@/services/figureCropper";
import type { LlmToolCall } from "@/services/llm";
import { RagService } from "@/services/rag";
import { DocumentDatabase } from "@/services/storage/database";
import { useDocumentStore } from "@/stores/documentStore";
import { useRagStore } from "@/stores/ragStore";
import type { TextMarkupAnnotation } from "@/types/annotations";
import type { ExecutedToolCall } from "@/types/chat";
import { readPageContextText, resolvePassageRects } from "@/utils/pdfDom";

export interface CopilotToolContext {
    docId?: string;
    docTitle?: string;
    jumpToPage?: (page: number) => void;
}

export async function executeCopilotToolCall(
    call: LlmToolCall,
    context: CopilotToolContext,
): Promise<ExecutedToolCall> {
    const args = call.arguments || {};
    const pageNumber = Math.max(1, Math.round(Number(args.pageNumber) || 1));

    if (call.name === "navigate_to") {
        context.jumpToPage?.(pageNumber);
        const reason =
            typeof args.reason === "string" && args.reason.trim()
                ? ` (${args.reason.trim()})`
                : "";
        const pageText = await readPageContextText(
            context.docId,
            pageNumber,
            context.jumpToPage,
        );
        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, reason: args.reason },
            status: "success",
            badgeLabel: `⚡ Navigated to Page ${pageNumber}`,
            result: pageText
                ? `Viewer navigated to Page ${pageNumber}${reason}. Page ${pageNumber} text:\n${pageText}`
                : `Viewer navigated to Page ${pageNumber}${reason}. (No extractable text found on this page yet.)`,
        };
    }

    if (call.name === "highlight_passage") {
        const passageText = String(args.text ?? "").trim();
        const color =
            typeof args.color === "string" && args.color.trim()
                ? args.color.trim()
                : "#FDE047";
        const label =
            typeof args.label === "string" && args.label.trim()
                ? args.label.trim()
                : "key finding";

        if (!context.docId || !passageText) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, text: passageText, color, label },
                status: "error",
                badgeLabel: `⚠️ Could not highlight Page ${pageNumber}`,
                result: "Missing active document ID or passage text.",
            };
        }

        const rectSegments = await resolvePassageRects(
            context.docId,
            pageNumber,
            passageText,
            context.jumpToPage,
        );

        if (rectSegments.length === 0) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, text: passageText, color, label },
                status: "error",
                badgeLabel: `⚡ Navigated to Page ${pageNumber}`,
                result: `Navigated to Page ${pageNumber}, but exact line coordinates for "${passageText.slice(0, 60)}" could not be resolved.`,
            };
        }

        const annotation: TextMarkupAnnotation = {
            id: `markup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            pageNumber,
            toolType: "highlight",
            color,
            text: passageText,
            rectSegments,
            x: rectSegments[0].x,
            y: rectSegments[0].y,
            createdAt: new Date().toISOString(),
        };

        await DocumentDatabase.appendAnnotation(context.docId, annotation);

        const docStoreAny = useDocumentStore.getState() as unknown as {
            addAnnotation?: (a: TextMarkupAnnotation) => void;
            loadAnnotations?: (docId: string) => Promise<void>;
        };
        if (typeof docStoreAny.addAnnotation === "function") {
            docStoreAny.addAnnotation(annotation);
        } else if (typeof docStoreAny.loadAnnotations === "function") {
            void docStoreAny.loadAnnotations(context.docId);
        }
        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent("foliet:annotation-saved", {
                    detail: { docId: context.docId, annotation },
                }),
            );
        }

        context.jumpToPage?.(pageNumber);
        useRagStore.getState().setActiveRagHighlight({
            chunkId: annotation.id,
            docId: context.docId,
            docTitle: context.docTitle || "Document",
            pageNumber,
            text: passageText,
            similarityScore: 1.0,
            rectSegments,
        });

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, text: passageText, color, label },
            status: "success",
            badgeLabel: `✏️ Highlighted ${label}`,
            result: `Persisted highlight annotation on Page ${pageNumber} for "${passageText.slice(0, 120)}".`,
        };
    }

    if (call.name === "explain_figure") {
        context.jumpToPage?.(pageNumber);
        const caption = typeof args.caption === "string" ? args.caption.trim() : "";

        let pageContext = "";
        if (context.docId) {
            try {
                const chunks = await RagService.getDocumentChunks(context.docId);
                const pageChunks = chunks.filter((c) => c.pageNumber === pageNumber);
                if (pageChunks.length > 0) {
                    const matched =
                        (caption &&
                            pageChunks.find((c) =>
                                c.text.toLowerCase().includes(caption.toLowerCase()),
                            )) ||
                        pageChunks[0];
                    useRagStore.getState().setActiveRagHighlight({
                        chunkId: matched.chunkId,
                        docId: context.docId,
                        docTitle: context.docTitle || "Document",
                        pageNumber,
                        text: matched.text,
                        similarityScore: 1.0,
                        rectSegments: matched.rectSegments,
                    });
                    pageContext = pageChunks
                        .slice(0, 2)
                        .map((c) => c.text)
                        .join("\n\n")
                        .slice(0, 1800);
                }
            } catch {
                // Fall back to DOM textLayer
            }
        }

        if (!pageContext) {
            pageContext = await readPageContextText(
                context.docId,
                pageNumber,
                context.jumpToPage,
            );
        }

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, caption },
            status: "success",
            badgeLabel: `🖼️ Focused Figure on Page ${pageNumber}`,
            result: pageContext
                ? `Navigated to Page ${pageNumber}${caption ? ` (${caption})` : ""}. Page context:\n${pageContext}`
                : `Navigated to Page ${pageNumber}${caption ? ` (${caption})` : ""}.`,
        };
    }

    if (call.name === "add_figure_to_summary") {
        const caption =
            typeof args.caption === "string" ? args.caption.trim() : undefined;
        const captured = await captureFigureCropFromPage(pageNumber, caption, {
            docId: context.docId,
            jumpToPage: context.jumpToPage,
        });

        if (!captured) {
            return {
                id: call.id,
                name: call.name,
                arguments: { pageNumber, caption },
                status: "error",
                badgeLabel: `⚠️ Could not capture figure on Page ${pageNumber}`,
                result: `Failed to locate or render canvas for Page ${pageNumber}.`,
            };
        }

        await insertFigureIntoSummary(captured.crop, context.docId);
        const uri = captured.crop.imageUrl.startsWith("idb://")
            ? captured.crop.imageUrl
            : `idb://${captured.crop.id}`;
        const label = captured.crop.caption || `Figure (Page ${pageNumber})`;

        return {
            id: call.id,
            name: call.name,
            arguments: { pageNumber, caption },
            status: "success",
            badgeLabel: `📎 Added figure from Page ${pageNumber} to Summary`,
            result: `Inserted ![${label}](${uri}) into the active summary (${captured.created ? "newly captured from page canvas" : "reused existing crop"}).`,
        };
    }

    return {
        id: call.id,
        name: call.name,
        arguments: args,
        status: "error",
        badgeLabel: `⚠️ Unknown tool: ${call.name}`,
        result: `Unsupported tool "${call.name}".`,
    };
}