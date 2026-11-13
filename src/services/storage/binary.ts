/**
 * Foliet - Binary & Media Storage Engine
 * Persists raw PDF ArrayBuffers, high-res Base64 figure crops,
 * annotations, and bookmarks in IndexedDB.
 */
import { PdfAnnotation } from "@/types/annotations";
import { BookmarkItem } from "@/types/document";

export class BinaryStorage {
    private static readonly DB_NAME = "FolietDB";
    private static readonly DB_VERSION = 1;
    private static readonly STORE_PDFS = "pdf_files";
    private static readonly STORE_CROPS = "pdf_crops";
    private static readonly STORE_ANNOTATIONS = "pdf_annotations";
    private static readonly STORE_BOOKMARKS = "pdf_bookmarks";

    private static cachedDb: IDBDatabase | null = null;
    private static openPromise: Promise<IDBDatabase> | null = null;

    /**
     * Normalizes crop keys so prefixed URIs (idb://, crop-) resolve reliably.
     */
    private static normalizeCropId(id: string): string {
        return id.replace(/^idb:\/\//, "").replace(/^(crop-)+/, "");
    }

    private static openDb(): Promise<IDBDatabase> {
        if (this.cachedDb) {
            return Promise.resolve(this.cachedDb);
        }
        if (this.openPromise) {
            return this.openPromise;
        }

        this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
            if (typeof window === "undefined" || !window.indexedDB) {
                this.openPromise = null;
                return reject(new Error("IndexedDB is unavailable in this environment"));
            }

            const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onblocked = () => {
                console.warn(
                    "BinaryStorage: IndexedDB version upgrade blocked by active connection."
                );
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.STORE_PDFS)) {
                    db.createObjectStore(this.STORE_PDFS);
                }
                if (!db.objectStoreNames.contains(this.STORE_CROPS)) {
                    db.createObjectStore(this.STORE_CROPS);
                }
                if (!db.objectStoreNames.contains(this.STORE_ANNOTATIONS)) {
                    db.createObjectStore(this.STORE_ANNOTATIONS);
                }
                if (!db.objectStoreNames.contains(this.STORE_BOOKMARKS)) {
                    db.createObjectStore(this.STORE_BOOKMARKS);
                }
            };

            request.onsuccess = () => {
                const db = request.result;
                this.cachedDb = db;
                this.openPromise = null;

                db.onversionchange = () => {
                    db.close();
                    this.cachedDb = null;
                };

                db.onclose = () => {
                    this.cachedDb = null;
                };

                resolve(db);
            };

            request.onerror = () => {
                this.openPromise = null;
                reject(request.error ?? new Error("Failed to open FolietDB"));
            };
        });

        return this.openPromise;
    }

    private static async writeKey(
        storeName: string,
        key: string,
        value: unknown
    ): Promise<void> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
        });
    }

    private static async readKey<T>(
        storeName: string,
        key: string
    ): Promise<T | null> {
        try {
            const db = await this.openDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readonly");
                const req = tx.objectStore(storeName).get(key);
                req.onsuccess = () => resolve((req.result as T) ?? null);
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn(`BinaryStorage: Failed to read from ${storeName}:`, err);
            return null;
        }
    }

    private static async deleteKey(
        storeName: string,
        key: string
    ): Promise<void> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
        });
    }

    // =========================================================================
    // PDF ArrayBuffer Methods
    // =========================================================================

    public static savePdfBuffer(
        id: string,
        buffer: ArrayBuffer
    ): Promise<void> {
        return this.writeKey(this.STORE_PDFS, id, buffer);
    }

    public static getPdfBuffer(id: string): Promise<ArrayBuffer | null> {
        return this.readKey<ArrayBuffer>(this.STORE_PDFS, id);
    }

    public static deletePdfBuffer(id: string): Promise<void> {
        return this.deleteKey(this.STORE_PDFS, id);
    }

    // =========================================================================
    // High-Resolution Multimodal Figure Crops
    // =========================================================================

    public static saveFigureCrop(id: string, base64: string): Promise<void> {
        return this.writeKey(this.STORE_CROPS, this.normalizeCropId(id), base64);
    }

    public static getFigureCrop(id: string): Promise<string | null> {
        return this.readKey<string>(this.STORE_CROPS, this.normalizeCropId(id));
    }

    public static deleteFigureCrop(id: string): Promise<void> {
        return this.deleteKey(this.STORE_CROPS, this.normalizeCropId(id));
    }

    // =========================================================================
    // Annotations Methods
    // =========================================================================

    public static async getAnnotations(docId: string): Promise<PdfAnnotation[]> {
        const result = await this.readKey<PdfAnnotation[]>(
            this.STORE_ANNOTATIONS,
            docId
        );
        return Array.isArray(result) ? result : [];
    }

    public static saveAnnotations(
        docId: string,
        annots: PdfAnnotation[]
    ): Promise<void> {
        return this.writeKey(this.STORE_ANNOTATIONS, docId, annots);
    }

    public static deleteAnnotations(docId: string): Promise<void> {
        return this.deleteKey(this.STORE_ANNOTATIONS, docId);
    }

    // =========================================================================
    // Bookmarks Methods
    // =========================================================================

    public static async getBookmarks(docId: string): Promise<BookmarkItem[]> {
        const result = await this.readKey<BookmarkItem[]>(
            this.STORE_BOOKMARKS,
            docId
        );
        return Array.isArray(result) ? result : [];
    }

    public static saveBookmarks(
        docId: string,
        bookmarks: BookmarkItem[]
    ): Promise<void> {
        return this.writeKey(this.STORE_BOOKMARKS, docId, bookmarks);
    }

    public static deleteBookmarks(docId: string): Promise<void> {
        return this.deleteKey(this.STORE_BOOKMARKS, docId);
    }

    // =========================================================================
    // Lifecycle / Cleanup Helpers
    // =========================================================================

    public static async deleteDocumentData(docId: string): Promise<void> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(
                [this.STORE_PDFS, this.STORE_ANNOTATIONS, this.STORE_BOOKMARKS],
                "readwrite"
            );
            tx.objectStore(this.STORE_PDFS).delete(docId);
            tx.objectStore(this.STORE_ANNOTATIONS).delete(docId);
            tx.objectStore(this.STORE_BOOKMARKS).delete(docId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
        });
    }

    public static async clearAll(): Promise<void> {
        const db = await this.openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(
                [
                    this.STORE_PDFS,
                    this.STORE_CROPS,
                    this.STORE_ANNOTATIONS,
                    this.STORE_BOOKMARKS,
                ],
                "readwrite"
            );
            tx.objectStore(this.STORE_PDFS).clear();
            tx.objectStore(this.STORE_CROPS).clear();
            tx.objectStore(this.STORE_ANNOTATIONS).clear();
            tx.objectStore(this.STORE_BOOKMARKS).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
        });
    }
}