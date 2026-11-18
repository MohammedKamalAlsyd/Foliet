/**
 * Lightweight persisted index record stored in `library.json`.
 */
import type { ReadingPosition } from "./common";

export interface CatalogItem extends ReadingPosition {
    id: string;
    title: string;
    fileName: string;
    filePath?: string;
    fileSize: number;
    pageCount: number;
    // Organization & bibliographic metadata
    authors?: string;
    year?: number;
    collection?: string;

    // Timestamps
    addedAt: number;
    lastOpenedAt: number;

    // Rag Data
    isIndexed?: boolean;

    // Other
    annotationCount?: number;
}