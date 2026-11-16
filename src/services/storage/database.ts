import Database from "@tauri-apps/plugin-sql";
import type { PdfAnnotation } from "@/types/annotations";
import type { BookmarkItem } from "@/types/document";
import type { ChatConversation, ChatMessage } from "@/types/chat";

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
                CREATE TABLE IF NOT EXISTS chat_conversations (
                    id TEXT PRIMARY KEY,
                    doc_id TEXT,
                    title TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_chat_conversations_doc_id
                    ON chat_conversations (doc_id);
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
    // Chat Conversations
    // =========================================================================

    public static async getConversations(
        docId?: string
    ): Promise<ChatConversation[]> {
        try {
            const db = await this.getDb();
            interface ChatRow {
                id: string;
                doc_id: string | null;
                title: string;
                data: string;
                created_at: number;
                updated_at: number;
            }

            const rows =
                docId !== undefined
                    ? await db.select<ChatRow[]>(
                          "SELECT id, doc_id, title, data, created_at, updated_at FROM chat_conversations WHERE doc_id = $1 ORDER BY updated_at DESC",
                          [docId]
                      )
                    : await db.select<ChatRow[]>(
                          "SELECT id, doc_id, title, data, created_at, updated_at FROM chat_conversations ORDER BY updated_at DESC"
                      );

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
        } catch (err) {
            console.warn("DocumentDatabase: Failed to read conversations:", err);
            return [];
        }
    }

    public static async saveConversation(conv: ChatConversation): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `INSERT OR REPLACE INTO chat_conversations (id, doc_id, title, data, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                conv.id,
                conv.docId ?? null,
                conv.title,
                JSON.stringify(conv.messages ?? []),
                conv.createdAt,
                conv.updatedAt,
            ]
        );
    }

    public static async deleteConversation(id: string): Promise<void> {
        const db = await this.getDb();
        await db.execute("DELETE FROM chat_conversations WHERE id = $1", [id]);
    }

    // =========================================================================
    // Document Summaries
    // =========================================================================

    public static async getSummary(
        docId: string
    ): Promise<{ content: string; sourceSnapshot?: string; updatedAt: number } | null> {
        try {
            const db = await this.getDb();
            interface SummaryRow {
                doc_id: string;
                content: string;
                source_snapshot: string | null;
                updated_at: number;
            }
            const rows = await db.select<SummaryRow[]>(
                "SELECT doc_id, content, source_snapshot, updated_at FROM doc_summaries WHERE doc_id = $1",
                [docId]
            );
            if (!rows[0]) return null;
            return {
                content: rows[0].content,
                sourceSnapshot: rows[0].source_snapshot ?? undefined,
                updatedAt: Number(rows[0].updated_at),
            };
        } catch (err) {
            console.warn("DocumentDatabase: Failed to read summary:", err);
            return null;
        }
    }

    public static async saveSummary(
        docId: string,
        content: string,
        sourceSnapshot?: string
    ): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `INSERT OR REPLACE INTO doc_summaries (doc_id, content, source_snapshot, updated_at)
             VALUES ($1, $2, $3, $4)`,
            [docId, content, sourceSnapshot ?? null, Date.now()]
        );
    }

    public static async deleteSummary(docId: string): Promise<void> {
        const db = await this.getDb();
        await db.execute("DELETE FROM doc_summaries WHERE doc_id = $1", [docId]);
    }

    // =========================================================================
    // Lifecycle / Cleanup
    // =========================================================================

    public static async deleteDocumentData(docId: string): Promise<void> {
        const db = await this.getDb();
        await db.execute(
            `DELETE FROM doc_annotations WHERE doc_id = $1;
             DELETE FROM doc_bookmarks WHERE doc_id = $1;
             DELETE FROM figure_crops WHERE doc_id = $1;
             DELETE FROM chat_conversations WHERE doc_id = $1;
             DELETE FROM doc_summaries WHERE doc_id = $1;`,
            [docId]
        );
    }

    public static async clearAll(): Promise<void> {
        const db = await this.getDb();
        await db.execute(`
            DELETE FROM doc_annotations;
            DELETE FROM doc_bookmarks;
            DELETE FROM figure_crops;
            DELETE FROM chat_conversations;
            DELETE FROM doc_summaries;
        `);
    }
}