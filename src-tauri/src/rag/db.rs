use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;

use super::models::{CatalogEntry, DocumentChunk, RagCatalog, RectSegment};

pub struct ChunkInsertRow {
    pub chunk_id: String,
    pub page_number: usize,
    pub chunk_index: usize,
    pub text: String,
    pub embedding: Vec<f32>,
    pub rects_json: Option<String>,
}

pub struct StoredVectorRow {
    pub chunk_id: String,
    pub doc_id: String,
    pub doc_title: String,
    pub page_number: usize,
    pub text: String,
    pub embedding_bytes: Vec<u8>,
    pub rects_json: Option<String>,
}

fn open_connection(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open rag.db: {}", e))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| format!("Failed to configure rag.db pragmas: {}", e))?;
    Ok(conn)
}

pub fn init_db(db_path: &Path) -> Result<(), String> {
    let conn = open_connection(db_path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS rag_documents (
            doc_id TEXT PRIMARY KEY,
            doc_title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            chunk_count INTEGER NOT NULL,
            embedding_model TEXT NOT NULL,
            provider TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            indexed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rag_chunks (
            chunk_id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL,
            page_number INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            embedding BLOB NOT NULL,
            rects_json TEXT,
            FOREIGN KEY (doc_id) REFERENCES rag_documents(doc_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc_id
            ON rag_chunks (doc_id);",
    )
    .map_err(|e| format!("Failed to initialize rag.db schema: {}", e))?;

    // Migrate existing rag.db tables created before rects_json was introduced
    let mut stmt = conn
        .prepare("PRAGMA table_info(rag_chunks)")
        .map_err(|e| format!("Failed to inspect rag_chunks schema: {}", e))?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("Failed to read rag_chunks columns: {}", e))?;
    let mut has_rects_json = false;
    for col in cols {
        if col.map_err(|e| format!("Column error: {}", e))? == "rects_json" {
            has_rects_json = true;
            break;
        }
    }
    if !has_rects_json {
        conn.execute("ALTER TABLE rag_chunks ADD COLUMN rects_json TEXT", [])
            .map_err(|e| format!("Failed to add rects_json column: {}", e))?;
    }

    Ok(())
}

fn f32_slice_to_le_bytes(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for &v in vec {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

pub fn parse_rects_json(raw: Option<String>) -> Option<Vec<RectSegment>> {
    raw.and_then(|s| serde_json::from_str::<Vec<RectSegment>>(&s).ok())
        .filter(|v| !v.is_empty())
}

pub fn replace_document_index(
    db_path: &Path,
    doc_id: &str,
    doc_title: &str,
    file_path: &str,
    embedding_model: &str,
    provider: &str,
    dimensions: usize,
    chunks: &[ChunkInsertRow],
) -> Result<(), String> {
    let mut conn = open_connection(db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start rag.db transaction: {}", e))?;

    tx.execute("DELETE FROM rag_chunks WHERE doc_id = ?1", params![doc_id])
        .map_err(|e| format!("Failed to clear old chunks: {}", e))?;

    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT OR REPLACE INTO rag_documents
            (doc_id, doc_title, file_path, chunk_count, embedding_model, provider, dimensions, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            doc_id,
            doc_title,
            file_path,
            chunks.len() as i64,
            embedding_model,
            provider,
            dimensions as i64,
            now
        ],
    )
    .map_err(|e| format!("Failed to upsert rag_documents: {}", e))?;

    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT INTO rag_chunks
                    (chunk_id, doc_id, page_number, chunk_index, text, embedding, rects_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| format!("Failed to prepare chunk insert: {}", e))?;

        for chunk in chunks {
            let blob = f32_slice_to_le_bytes(&chunk.embedding);
            stmt.execute(params![
                chunk.chunk_id,
                doc_id,
                chunk.page_number as i64,
                chunk.chunk_index as i64,
                chunk.text,
                blob,
                chunk.rects_json
            ])
            .map_err(|e| format!("Failed to insert chunk '{}': {}", chunk.chunk_id, e))?;
        }
    }

    tx.commit()
        .map_err(|e| format!("Failed to commit rag.db transaction: {}", e))?;

    Ok(())
}

pub fn remove_document_index(db_path: &Path, doc_id: &str) -> Result<(), String> {
    let mut conn = open_connection(db_path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start delete transaction: {}", e))?;

    tx.execute("DELETE FROM rag_chunks WHERE doc_id = ?1", params![doc_id])
        .map_err(|e| format!("Failed to delete chunks: {}", e))?;
    tx.execute(
        "DELETE FROM rag_documents WHERE doc_id = ?1",
        params![doc_id],
    )
    .map_err(|e| format!("Failed to delete document record: {}", e))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit delete transaction: {}", e))?;
    Ok(())
}

pub fn get_catalog(db_path: &Path) -> Result<RagCatalog, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT doc_id, doc_title, file_path, chunk_count, embedding_model, provider, indexed_at
             FROM rag_documents
             ORDER BY indexed_at DESC",
        )
        .map_err(|e| format!("Failed to prepare catalog query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(CatalogEntry {
                doc_id: row.get(0)?,
                doc_title: row.get(1)?,
                file_path: row.get(2)?,
                chunk_count: row.get::<_, i64>(3)? as usize,
                embedding_model: row.get(4)?,
                provider: row.get(5)?,
                indexed_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query catalog: {}", e))?;

    let mut documents = Vec::new();
    for item in rows {
        documents.push(item.map_err(|e| format!("Catalog row error: {}", e))?);
    }

    Ok(RagCatalog { documents })
}

pub fn get_document_chunks(db_path: &Path, doc_id: &str) -> Result<Vec<DocumentChunk>, String> {
    let conn = open_connection(db_path)?;
    let mut stmt = conn
        .prepare(
            "SELECT chunk_id, page_number, chunk_index, text, rects_json
             FROM rag_chunks
             WHERE doc_id = ?1
             ORDER BY chunk_index ASC",
        )
        .map_err(|e| format!("Failed to prepare chunks query: {}", e))?;

    let rows = stmt
        .query_map(params![doc_id], |row| {
            let rects_raw: Option<String> = row.get(4)?;
            Ok(DocumentChunk {
                chunk_id: row.get(0)?,
                page_number: row.get::<_, i64>(1)? as usize,
                chunk_index: row.get::<_, i64>(2)? as usize,
                text: row.get(3)?,
                rect_segments: parse_rects_json(rects_raw),
            })
        })
        .map_err(|e| format!("Failed to query chunks: {}", e))?;

    let mut chunks = Vec::new();
    for item in rows {
        chunks.push(item.map_err(|e| format!("Chunk row error: {}", e))?);
    }
    Ok(chunks)
}

pub fn get_document_embedding_info(
    db_path: &Path,
    doc_id: &str,
) -> Result<Option<(String, String, usize)>, String> {
    let conn = open_connection(db_path)?;
    conn.query_row(
        "SELECT provider, embedding_model, dimensions FROM rag_documents WHERE doc_id = ?1",
        params![doc_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? as usize,
            ))
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read document embedding metadata: {}", e))
}

pub fn load_candidate_vectors(
    db_path: &Path,
    target_doc_id: Option<&str>,
    embedding_model: &str,
    dimensions: usize,
) -> Result<Vec<StoredVectorRow>, String> {
    let conn = open_connection(db_path)?;
    let mut results = Vec::new();

    if let Some(doc_id) = target_doc_id {
        let mut stmt = conn
            .prepare(
                "SELECT c.chunk_id, c.doc_id, d.doc_title, c.page_number, c.text, c.embedding, c.rects_json
                 FROM rag_chunks c
                 INNER JOIN rag_documents d ON c.doc_id = d.doc_id
                 WHERE c.doc_id = ?1 AND d.dimensions = ?2",
            )
            .map_err(|e| format!("Failed to prepare doc vector query: {}", e))?;

        let rows = stmt
            .query_map(params![doc_id, dimensions as i64], |row| {
                Ok(StoredVectorRow {
                    chunk_id: row.get(0)?,
                    doc_id: row.get(1)?,
                    doc_title: row.get(2)?,
                    page_number: row.get::<_, i64>(3)? as usize,
                    text: row.get(4)?,
                    embedding_bytes: row.get(5)?,
                    rects_json: row.get(6)?,
                })
            })
            .map_err(|e| format!("Failed to query doc vectors: {}", e))?;

        for row in rows {
            results.push(row.map_err(|e| format!("Vector row error: {}", e))?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT c.chunk_id, c.doc_id, d.doc_title, c.page_number, c.text, c.embedding, c.rects_json
                 FROM rag_chunks c
                 INNER JOIN rag_documents d ON c.doc_id = d.doc_id
                 WHERE d.embedding_model = ?1 AND d.dimensions = ?2",
            )
            .map_err(|e| format!("Failed to prepare global vector query: {}", e))?;

        let rows = stmt
            .query_map(params![embedding_model, dimensions as i64], |row| {
                Ok(StoredVectorRow {
                    chunk_id: row.get(0)?,
                    doc_id: row.get(1)?,
                    doc_title: row.get(2)?,
                    page_number: row.get::<_, i64>(3)? as usize,
                    text: row.get(4)?,
                    embedding_bytes: row.get(5)?,
                    rects_json: row.get(6)?,
                })
            })
            .map_err(|e| format!("Failed to query global vectors: {}", e))?;

        for row in rows {
            results.push(row.map_err(|e| format!("Vector row error: {}", e))?);
        }
    }

    Ok(results)
}
