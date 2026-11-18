/**
 * Foliet - Document Catalog, Navigation & IPC Types
 */
import type { PdfAnnotation } from "./annotations";
import type { ReadingPosition } from "./common";

export interface PdfOutlineNode {
    id: string;
    title: string;
    pageNumber: number;
    level: number;
    children?: PdfOutlineNode[];
    dest?: unknown;
}

export interface PdfChapter {
    id: string;
    title: string;
    startPage: number;
    endPage: number;
    level: number;
}

export interface BookmarkItem {
    id: string;
    pageNumber: number;
    title: string;
    createdAt: string;
    color?: string;
}

export interface DocumentItem extends Partial<ReadingPosition> {
    id: string;
    title: string;
    pages: number;
    filePath?: string;
    extractedAnnotations?: PdfAnnotation[];
    isIndexed?: boolean;
}

export interface PdfOpenResult {
    docId: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    numPages: number;
    extractedAnnotations?: PdfAnnotation[];
}