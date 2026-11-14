/**
 * Lightweight persisted index record stored in `library.json`.
 * Never holds raw PDF bytes, annotations, or transient UI state.
 */
export interface CatalogItem {
    id: string;
    title: string;
    fileName: string;
    filePath?: string;
    fileSize: number;
    pageCount: number;

    // Reading state persisted across sessions
    lastPage: number;
    scrollOffset: number;
    zoom: number;

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