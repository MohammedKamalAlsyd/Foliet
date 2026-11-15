import Database from "@tauri-apps/plugin-sql";
import type { PdfAnnotation } from "@/types/annotations";
import type { BookmarkItem } from "@/types/document";

interface JsonRow {
    data: string;
}

export class DocumentDatabase {
    private static readonly DB_URL = "sqlite:foliet.db";
    private static dbPromise: Promise<Database> | null = null;

    /** Normalizes crop keys so prefixed URIs (idb://, db://, crop-) resolve reliably. */
    private static normalizeCropId(id: string): string {
        return id.replace(/^(?:idb|db):\/\//, "").replace(/^(crop-)+/, "");
    }

    private static getDb(): Promise<Database> {
        if (this.dbPromise) return this.dbPromise;

        this.dbPromise = (async () => {
            const db = await Database.load(this.DB_URL);
            await db.execute(`
                CREATE TABLE IF NOT EXISTS doc_annotations (
                    doc_id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS doc_bookmarks (
                    doc_id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS figure_crops (
                    id TEXT PRIMARY KEY,
                    doc_id TEXT,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_figure_crops_doc_id
                    ON figure_crops (doc_id);
            `);
            return db;
        })().catch((err) => {
            this.dbPromise = null;
            throw err;
        });

        return this.dbPromise;
    }

    // =========================================================================
    // Annotations
    // =========================================================================

    public static async getAnnotations(docId: string): Promise<PdfAnnotation[]> {
        try {
            const db = await this.getDb();
            const rows = await db.select<JsonRow[]>(
                "SELECT data FROM doc_annotations WHERE doc_id = $1",
                [docId]
            );
            if (!rows[0]?.data) return [];
            const parsed = JSON.parse(rows[0].data);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.warn("DocumentDatabase: Failed to read annotations:", err);
            return [];
        }
    }

    public static async saveAnnotations(
        docId: string,
        annots: PdfAnnotation[]
    ): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `INSERT OR REPLACE INTO doc_annotations (doc_id, data, updated_at)
             VALUES ($1, $2, $3)`,
            [docId, JSON.stringify(annots), Date.now()]
        );
    }

    public static async deleteAnnotations(docId: string): Promise<void> {
        const db = await this.getDb();
        await db.execute("DELETE FROM doc_annotations WHERE doc_id = $1", [docId]);
    }

    // =========================================================================
    // Bookmarks
    // =========================================================================

    public static async getBookmarks(docId: string): Promise<BookmarkItem[]> {
        try {
            const db = await this.getDb();
            const rows = await db.select<JsonRow[]>(
                "SELECT data FROM doc_bookmarks WHERE doc_id = $1",
                [docId]
            );
            if (!rows[0]?.data) return [];
            const parsed = JSON.parse(rows[0].data);
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            console.warn("DocumentDatabase: Failed to read bookmarks:", err);
            return [];
        }
    }

    public static async saveBookmarks(
        docId: string,
        bookmarks: BookmarkItem[]
    ): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `INSERT OR REPLACE INTO doc_bookmarks (doc_id, data, updated_at)
             VALUES ($1, $2, $3)`,
            [docId, JSON.stringify(bookmarks), Date.now()]
        );
    }

    public static async deleteBookmarks(docId: string): Promise<void> {
        const db = await this.getDb();
        await db.execute("DELETE FROM doc_bookmarks WHERE doc_id = $1", [docId]);
    }

    // =========================================================================
    // Figure Crops
    // =========================================================================

    public static async saveFigureCrop(
        id: string,
        base64: string,
        docId?: string
    ): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `INSERT OR REPLACE INTO figure_crops (id, doc_id, data, created_at)
             VALUES ($1, $2, $3, $4)`,
            [this.normalizeCropId(id), docId ?? null, base64, Date.now()]
        );
    }

    public static async getFigureCrop(id: string): Promise<string | null> {
        try {
            const db = await this.getDb();
            const rows = await db.select<JsonRow[]>(
                "SELECT data FROM figure_crops WHERE id = $1",
                [this.normalizeCropId(id)]
            );
            return rows[0]?.data ?? null;
        } catch (err) {
            console.warn("DocumentDatabase: Failed to read figure crop:", err);
            return null;
        }
    }

    public static async deleteFigureCrop(id: string): Promise<void> {
        const db = await this.getDb();
        await db.execute("DELETE FROM figure_crops WHERE id = $1", [
            this.normalizeCropId(id),
        ]);
    }

    // =========================================================================
    // Lifecycle / Cleanup
    // =========================================================================

    public static async deleteDocumentData(docId: string): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `DELETE FROM doc_annotations WHERE doc_id = $1;
             DELETE FROM doc_bookmarks WHERE doc_id = $1;
             DELETE FROM figure_crops WHERE doc_id = $1;`,
            [docId]
        );
    }

    public static async clearAll(): Promise<void> {
        const db = await this.getDb();
        await db.execute(`
            DELETE FROM doc_annotations;
            DELETE FROM doc_bookmarks;
            DELETE FROM figure_crops;
        `);
    }
}