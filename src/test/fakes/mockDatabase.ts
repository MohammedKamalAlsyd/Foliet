import type { PdfAnnotation } from "@/types/annotations";
import type { ChatConversation } from "@/types/chat";
import type { BookmarkItem } from "@/types/document";

export interface StoredSummaryRecord {
  content: string;
  sourceSnapshot?: string;
  updatedAt: number;
}

/** Valid 1x1 transparent PNG data URI for figure crop / export testing */
export const SAMPLE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function normalizeCropId(id: string): string {
  return id.replace(/^(?:idb|db):\/\//, "").replace(/^(crop-)+/, "");
}

export class InMemoryDocumentDatabase {
  public annotations = new Map<string, PdfAnnotation[]>();
  public bookmarks = new Map<string, BookmarkItem[]>();
  public figureCrops = new Map<string, { docId?: string; data: string }>();
  public conversations = new Map<string, ChatConversation>();
  public summaries = new Map<string, StoredSummaryRecord>();
  public summaryBackups = new Map<string, StoredSummaryRecord>();

  public reset(): void {
    this.annotations.clear();
    this.bookmarks.clear();
    this.figureCrops.clear();
    this.conversations.clear();
    this.summaries.clear();
    this.summaryBackups.clear();
  }

  public async getAnnotations(docId: string): Promise<PdfAnnotation[]> {
    return structuredClone(this.annotations.get(docId) ?? []);
  }

  public async saveAnnotations(
    docId: string,
    annots: PdfAnnotation[],
  ): Promise<void> {
    this.annotations.set(docId, structuredClone(annots));
  }

  public async appendAnnotation(
    docId: string,
    annotation: PdfAnnotation,
  ): Promise<void> {
    const current = this.annotations.get(docId) ?? [];
    this.annotations.set(docId, [
      structuredClone(annotation),
      ...current.filter((a) => a.id !== annotation.id),
    ]);
  }

  public async removeAnnotation(
    docId: string,
    annotationId: string,
  ): Promise<void> {
    const current = this.annotations.get(docId) ?? [];
    const next = current.filter((a) => a.id !== annotationId);
    if (next.length !== current.length) {
      this.annotations.set(docId, next);
    }
  }

  public async deleteAnnotations(docId: string): Promise<void> {
    this.annotations.delete(docId);
  }

  public async getBookmarks(docId: string): Promise<BookmarkItem[]> {
    return structuredClone(this.bookmarks.get(docId) ?? []);
  }

  public async saveBookmarks(
    docId: string,
    items: BookmarkItem[],
  ): Promise<void> {
    this.bookmarks.set(docId, structuredClone(items));
  }

  public async deleteBookmarks(docId: string): Promise<void> {
    this.bookmarks.delete(docId);
  }

  public async saveFigureCrop(
    id: string,
    base64: string,
    docId?: string,
  ): Promise<void> {
    this.figureCrops.set(normalizeCropId(id), { docId, data: base64 });
  }

  public async getFigureCrop(id: string): Promise<string | null> {
    return this.figureCrops.get(normalizeCropId(id))?.data ?? null;
  }

  public async deleteFigureCrop(id: string): Promise<void> {
    this.figureCrops.delete(normalizeCropId(id));
  }

  public async getConversations(docId?: string): Promise<ChatConversation[]> {
    const all = Array.from(this.conversations.values());
    const filtered =
      docId !== undefined ? all.filter((c) => c.docId === docId) : all;
    return structuredClone(
      filtered.sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }

  public async saveConversation(conv: ChatConversation): Promise<void> {
    this.conversations.set(conv.id, structuredClone(conv));
  }

  public async deleteConversation(id: string): Promise<void> {
    this.conversations.delete(id);
  }

  public async getSummary(docId: string): Promise<StoredSummaryRecord | null> {
    const row = this.summaries.get(docId);
    return row ? structuredClone(row) : null;
  }

  public async saveSummary(
    docId: string,
    content: string,
    sourceSnapshot?: string,
  ): Promise<void> {
    this.summaries.set(docId, {
      content,
      sourceSnapshot,
      updatedAt: Date.now(),
    });
  }

  public async deleteSummary(docId: string): Promise<void> {
    this.summaries.delete(docId);
  }

  public async getSummaryBackup(
    docId: string,
  ): Promise<StoredSummaryRecord | null> {
    const row = this.summaryBackups.get(docId);
    return row ? structuredClone(row) : null;
  }

  public async saveSummaryBackup(
    docId: string,
    content: string,
    sourceSnapshot?: string,
    updatedAt?: number,
  ): Promise<void> {
    this.summaryBackups.set(docId, {
      content,
      sourceSnapshot,
      updatedAt: updatedAt ?? Date.now(),
    });
  }

  public async deleteSummaryBackup(docId: string): Promise<void> {
    this.summaryBackups.delete(docId);
  }

  public async deleteDocumentData(docId: string): Promise<void> {
    this.annotations.delete(docId);
    this.bookmarks.delete(docId);
    for (const [k, v] of this.figureCrops.entries()) {
      if (v.docId === docId) this.figureCrops.delete(k);
    }
    for (const [k, v] of this.conversations.entries()) {
      if (v.docId === docId) this.conversations.delete(k);
    }
    this.summaries.delete(docId);
    this.summaryBackups.delete(docId);
  }

  public async clearAll(): Promise<void> {
    this.reset();
  }
}

export const mockDatabase = new InMemoryDocumentDatabase();

/**
 * Facade matching `DocumentDatabase`'s static API for `vi.mock("@/services/storage/database")`.
 */
export const MockDocumentDatabase = {
  getAnnotations: (docId: string) => mockDatabase.getAnnotations(docId),
  saveAnnotations: (docId: string, annots: PdfAnnotation[]) =>
    mockDatabase.saveAnnotations(docId, annots),
  appendAnnotation: (docId: string, annotation: PdfAnnotation) =>
    mockDatabase.appendAnnotation(docId, annotation),
  removeAnnotation: (docId: string, annotationId: string) =>
    mockDatabase.removeAnnotation(docId, annotationId),
  deleteAnnotations: (docId: string) => mockDatabase.deleteAnnotations(docId),
  getBookmarks: (docId: string) => mockDatabase.getBookmarks(docId),
  saveBookmarks: (docId: string, items: BookmarkItem[]) =>
    mockDatabase.saveBookmarks(docId, items),
  deleteBookmarks: (docId: string) => mockDatabase.deleteBookmarks(docId),
  saveFigureCrop: (id: string, base64: string, docId?: string) =>
    mockDatabase.saveFigureCrop(id, base64, docId),
  getFigureCrop: (id: string) => mockDatabase.getFigureCrop(id),
  deleteFigureCrop: (id: string) => mockDatabase.deleteFigureCrop(id),
  getConversations: (docId?: string) => mockDatabase.getConversations(docId),
  saveConversation: (conv: ChatConversation) =>
    mockDatabase.saveConversation(conv),
  deleteConversation: (id: string) => mockDatabase.deleteConversation(id),
  getSummary: (docId: string) => mockDatabase.getSummary(docId),
  saveSummary: (docId: string, content: string, sourceSnapshot?: string) =>
    mockDatabase.saveSummary(docId, content, sourceSnapshot),
  deleteSummary: (docId: string) => mockDatabase.deleteSummary(docId),
  getSummaryBackup: (docId: string) => mockDatabase.getSummaryBackup(docId),
  saveSummaryBackup: (
    docId: string,
    content: string,
    sourceSnapshot?: string,
    updatedAt?: number,
  ) => mockDatabase.saveSummaryBackup(docId, content, sourceSnapshot, updatedAt),
  deleteSummaryBackup: (docId: string) =>
    mockDatabase.deleteSummaryBackup(docId),
  deleteDocumentData: (docId: string) => mockDatabase.deleteDocumentData(docId),
  clearAll: () => mockDatabase.clearAll(),
};
