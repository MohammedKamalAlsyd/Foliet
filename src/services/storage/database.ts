import Database from "@tauri-apps/plugin-sql";
import type { PdfAnnotation } from "@/types/annotations";
import type { BookmarkItem } from "@/types/document";
import type { ChatConversation, ChatMessage } from "@/types/chat";

interface JsonRow {
    data: string;
}

interface ChatRow {
    id: string;
    doc_id: string | null;
    title: string;
    data: string;
    created_at: number;
    updated_at: number;
}

interface SummaryRow {
    doc_id: string;
    content: string;
    source_snapshot: string | null;
    updated_at: number;
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
                CREATE INDEX IF NOT EXISTS idx_figure_crops_doc_id ON figure_crops (doc_id);
                CREATE TABLE IF NOT EXISTS chat_conversations (
                    id TEXT PRIMARY KEY,
                    doc_id TEXT,
                    title TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_chat_conversations_doc_id ON chat_conversations (doc_id);
                CREATE TABLE IF NOT EXISTS doc_summaries (
                    doc_id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    source_snapshot TEXT,
                    updated_at INTEGER NOT NULL
                );
            `);
            return db;
        })().catch((err) => {
            this.dbPromise = null;
            throw err;
        });

        return this.dbPromise;
    }

    private static async query<T>(sql: string, params: unknown[] = [], label = "query"): Promise<T[]> {
        try {
            const db = await this.getDb();
            return await db.select<T[]>(sql, params);
        } catch (err) {
            console.warn(`DocumentDatabase: Failed to execute ${label}:`, err);
            return [];
        }
    }

    private static async execute(sql: string, params: unknown[] = []): Promise<void> {
        const db = await this.getDb();
        await db.execute(sql, params);
    }

    private static async getJsonArray<T>(
        table: "doc_annotations" | "doc_bookmarks",
        docId: string,
        label: string,
    ): Promise<T[]> {
        const rows = await this.query<JsonRow>(
            `SELECT data FROM ${table} WHERE doc_id = $1`,
            [docId],
            label,
        );
        if (!rows[0]?.data) return [];
        try {
            const parsed = JSON.parse(rows[0].data);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private static async saveJsonArray<T>(
        table: "doc_annotations" | "doc_bookmarks",
        docId: string,
        items: T[],
    ): Promise<void> {
        await this.execute(
            `INSERT OR REPLACE INTO ${table} (doc_id, data, updated_at) VALUES ($1, $2, $3)`,
            [docId, JSON.stringify(items), Date.now()],
        );
    }

    // =========================================================================
    // Annotations
    // =========================================================================

    public static getAnnotations(docId: string): Promise<PdfAnnotation[]> {
        return this.getJsonArray<PdfAnnotation>("doc_annotations", docId, "annotations");
    }

    public static saveAnnotations(docId: string, annots: PdfAnnotation[]): Promise<void> {
        return this.saveJsonArray("doc_annotations", docId, annots);
    }

    public static async appendAnnotation(docId: string, annotation: PdfAnnotation): Promise<void> {
        const current = await this.getAnnotations(docId);
        await this.saveAnnotations(docId, [annotation, ...current.filter((a) => a.id !== annotation.id)]);
    }

    public static async removeAnnotation(docId: string, annotationId: string): Promise<void> {
        const current = await this.getAnnotations(docId);
        const next = current.filter((a) => a.id !== annotationId);
        if (next.length !== current.length) await this.saveAnnotations(docId, next);
    }

    public static deleteAnnotations(docId: string): Promise<void> {
        return this.execute("DELETE FROM doc_annotations WHERE doc_id = $1", [docId]);
    }

    // =========================================================================
    // Bookmarks
    // =========================================================================

    public static getBookmarks(docId: string): Promise<BookmarkItem[]> {
        return this.getJsonArray<BookmarkItem>("doc_bookmarks", docId, "bookmarks");
    }

    public static saveBookmarks(docId: string, bookmarks: BookmarkItem[]): Promise<void> {
        return this.saveJsonArray("doc_bookmarks", docId, bookmarks);
    }

    public static deleteBookmarks(docId: string): Promise<void> {
        return this.execute("DELETE FROM doc_bookmarks WHERE doc_id = $1", [docId]);
    }

    // =========================================================================
    // Figure Crops
    // =========================================================================

    public static saveFigureCrop(id: string, base64: string, docId?: string): Promise<void> {
        return this.execute(
            `INSERT OR REPLACE INTO figure_crops (id, doc_id, data, created_at) VALUES ($1, $2, $3, $4)`,
            [this.normalizeCropId(id), docId ?? null, base64, Date.now()],
        );
    }

    public static async getFigureCrop(id: string): Promise<string | null> {
        const rows = await this.query<JsonRow>(
            "SELECT data FROM figure_crops WHERE id = $1",
            [this.normalizeCropId(id)],
            "figure crop",
        );
        return rows[0]?.data ?? null;
    }

    public static deleteFigureCrop(id: string): Promise<void> {
        return this.execute("DELETE FROM figure_crops WHERE id = $1", [this.normalizeCropId(id)]);
    }

    // =========================================================================
    // Chat Conversations
    // =========================================================================

    public static async getConversations(docId?: string): Promise<ChatConversation[]> {
        const sql =
            docId !== undefined
                ? "SELECT id, doc_id, title, data, created_at, updated_at FROM chat_conversations WHERE doc_id = $1 ORDER BY updated_at DESC"
                : "SELECT id, doc_id, title, data, created_at, updated_at FROM chat_conversations ORDER BY updated_at DESC";
        const rows = await this.query<ChatRow>(sql, docId !== undefined ? [docId] : [], "conversations");

        return rows.map((row) => {
            let messages: ChatMessage[] = [];
            try {
                const parsed = JSON.parse(row.data);
                messages = Array.isArray(parsed)
                    ? parsed
                    : Array.isArray(parsed?.messages)
                        ? parsed.messages
                        : [];
            } catch {
                messages = [];
            }
            return {
                id: row.id,
                docId: row.doc_id ?? undefined,
                title: row.title,
                createdAt: Number(row.created_at),
                updatedAt: Number(row.updated_at),
                messages,
            };
        });
    }

    public static saveConversation(conv: ChatConversation): Promise<void> {
        return this.execute(
            `INSERT OR REPLACE INTO chat_conversations (id, doc_id, title, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                conv.id,
                conv.docId ?? null,
                conv.title,
                JSON.stringify(conv.messages ?? []),
                conv.createdAt,
                conv.updatedAt,
            ],
        );
    }

    public static deleteConversation(id: string): Promise<void> {
        return this.execute("DELETE FROM chat_conversations WHERE id = $1", [id]);
    }

    // =========================================================================
    // Document Summaries
    // =========================================================================

    public static async getSummary(
        docId: string,
    ): Promise<{ content: string; sourceSnapshot?: string; updatedAt: number } | null> {
        const rows = await this.query<SummaryRow>(
            "SELECT doc_id, content, source_snapshot, updated_at FROM doc_summaries WHERE doc_id = $1",
            [docId],
            "summary",
        );
        if (!rows[0]) return null;
        return {
            content: rows[0].content,
            sourceSnapshot: rows[0].source_snapshot ?? undefined,
            updatedAt: Number(rows[0].updated_at),
        };
    }

    public static saveSummary(
        docId: string,
        content: string,
        sourceSnapshot?: string,
    ): Promise<void> {
        return this.execute(
            `INSERT OR REPLACE INTO doc_summaries (doc_id, content, source_snapshot, updated_at) VALUES ($1, $2, $3, $4)`,
            [docId, content, sourceSnapshot ?? null, Date.now()],
        );
    }

    public static deleteSummary(docId: string): Promise<void> {
        return this.execute("DELETE FROM doc_summaries WHERE doc_id = $1", [docId]);
    }

    // =========================================================================
    // Lifecycle / Cleanup
    // =========================================================================

    public static deleteDocumentData(docId: string): Promise<void> {
        return this.execute(
            `DELETE FROM doc_annotations WHERE doc_id = $1;
             DELETE FROM doc_bookmarks WHERE doc_id = $1;
             DELETE FROM figure_crops WHERE doc_id = $1;
             DELETE FROM chat_conversations WHERE doc_id = $1;
             DELETE FROM doc_summaries WHERE doc_id = $1;`,
            [docId],
        );
    }

    public static clearAll(): Promise<void> {
        return this.execute(`
            DELETE FROM doc_annotations;
            DELETE FROM doc_bookmarks;
            DELETE FROM figure_crops;
            DELETE FROM chat_conversations;
            DELETE FROM doc_summaries;
        `);
    }
}
