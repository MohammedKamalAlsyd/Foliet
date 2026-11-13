/**
 * Foliet - Document Catalog, Navigation & IPC Types
 */
import type { PdfAnnotation } from "./annotations";

export interface PageDimensions {
    width: number;
    height: number;
}

export interface PdfOutlineNode {
    id: string;
    title: string;
    pageNumber: number;
    level: number;
    children?: PdfOutlineNode[];
    dest?: unknown;
}

export interface BookmarkItem {
    id: string;
    pageNumber: number;
    title: string;
    createdAt: string;
    color?: string;
}

export interface DocumentItem {
    id: string;
    title: string;
    pages: number;
    extractedAnnotations?: PdfAnnotation[];
}