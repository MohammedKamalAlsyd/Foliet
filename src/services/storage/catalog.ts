import { LazyStore } from "@tauri-apps/plugin-store";
import { BinaryStorage } from "@/services/storage/binary";
import type { CatalogItem } from "@/types/catalog";

export function normalizePath(p?: string): string {
    if (!p) return "";
    let clean = p.trim().replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(clean)) {
        clean = clean[0].toLowerCase() + clean.slice(1);
    }
    return clean;
}

/**
 * Picks only persisted `CatalogItem` fields so runtime properties
 * never leak into `library.json`.
 */
export function toCatalogItem(item: CatalogItem): CatalogItem {
    return {
        id: item.id,
        title: item.title,
        fileName: item.fileName,
        filePath: item.filePath,
        fileSize: item.fileSize,
        pageCount: item.pageCount,
        lastPage: item.lastPage,
        scrollOffset: item.scrollOffset,
        zoom: item.zoom,
        authors: item.authors,
        year: item.year,
        collection: item.collection,
        addedAt: item.addedAt,
        lastOpenedAt: item.lastOpenedAt,
        isIndexed: item.isIndexed,
        annotationCount: item.annotationCount,
    };
}

export function deduplicateDocuments(docs: CatalogItem[]): CatalogItem[] {
    const seenPaths = new Set<string>();
    const seenIds = new Set<string>();
    const result: CatalogItem[] = [];

    for (const doc of docs) {
        const normPath = normalizePath(doc.filePath);
        if (!doc.id || seenIds.has(doc.id)) continue;
        if (normPath && seenPaths.has(normPath)) continue;

        seenIds.add(doc.id);
        if (normPath) seenPaths.add(normPath);
        result.push(doc);
    }

    return result;
}

export class DocumentCatalogStorage {
    private static store = new LazyStore("library.json");

    public static async getDocuments(): Promise<CatalogItem[]> {
        try {
            const docs = await this.store.get<CatalogItem[]>("documents");
            if (Array.isArray(docs)) {
                return deduplicateDocuments(docs.map(toCatalogItem));
            }
            return [];
        } catch (err) {
            console.error(
                "DocumentCatalogStorage: Failed to read library catalog:",
                err
            );
            return [];
        }
    }

    public static async saveDocuments(docs: CatalogItem[]): Promise<void> {
        const sanitized = docs.map(toCatalogItem);
        const deduplicated = deduplicateDocuments(sanitized);
        await this.store.set("documents", deduplicated);
        await this.store.save();
    }

    public static async updateDocument(
        docId: string,
        patch: Partial<CatalogItem>
    ): Promise<void> {
        const current = await this.getDocuments();
        const next = current.map((doc) =>
            doc.id === docId ? { ...doc, ...patch, id: doc.id } : doc
        );
        await this.saveDocuments(next);
    }

    public static async removeDocument(docId: string): Promise<void> {
        const current = await this.getDocuments();
        const filtered = current.filter((d) => d.id !== docId);
        await this.saveDocuments(filtered);
        await BinaryStorage.deleteDocumentData(docId);
    }

    public static async clearAll(): Promise<void> {
        await this.store.set("documents", []);
        await this.store.save();
        await BinaryStorage.clearAll();
    }
}