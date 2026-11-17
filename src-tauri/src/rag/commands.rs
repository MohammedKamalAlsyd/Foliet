use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

use super::RagState;
use super::db::{self, ChunkInsertRow};
use super::downloader;
use super::embedder;
use super::models::{
    DocumentChunk, DownloadedModelInfo, EmbeddingConfig, IndexDocumentResult, IndexingScope,
    ModelStatus, RagCatalog, RagHyperparameters, RagIndexProgress, RagSearchQuery, RagSearchResult,
};
use super::pdf_text;

#[inline]
fn dot_product_le_bytes(query: &[f32], bytes: &[u8]) -> f32 {
    if bytes.len() != query.len() * 4 {
        return -1.0;
    }
    let mut sum = 0.0f32;
    for (q, chunk) in query.iter().zip(bytes.chunks_exact(4)) {
        let v = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        sum += q * v;
    }
    sum
}

#[tauri::command]
pub async fn rag_get_model_status(
    state: State<'_, RagState>,
    provider: String,
    model_id: String,
) -> Result<ModelStatus, String> {
    Ok(downloader::get_local_model_status(
        &state, &provider, &model_id,
    ))
}

#[tauri::command]
pub async fn rag_download_model(
    app: AppHandle,
    state: State<'_, RagState>,
    model_id: String,
) -> Result<(), String> {
    downloader::download_local_model(&app, &state, &model_id).await
}

#[tauri::command]
pub async fn rag_delete_model(state: State<'_, RagState>, model_id: String) -> Result<(), String> {
    downloader::delete_local_model(&state, &model_id).await
}

#[tauri::command]
pub async fn rag_list_downloaded_models(
    state: State<'_, RagState>,
) -> Result<Vec<DownloadedModelInfo>, String> {
    downloader::list_downloaded_models(&state)
}

#[tauri::command]
pub async fn rag_index_document(
    app: AppHandle,
    state: State<'_, RagState>,
    scope: IndexingScope,
    config: RagHyperparameters,
    embedding_config: EmbeddingConfig,
) -> Result<IndexDocumentResult, String> {
    if scope.file_path.trim().is_empty() {
        return Err("Document file path is required for indexing.".to_string());
    }

    let doc_id = scope.doc_id.clone();
    let doc_title = scope.doc_title.clone();
    let file_path = scope.file_path.clone();
    let ranges = scope.selected_page_ranges.clone();

    let _ = app.emit(
        "rag_index_progress",
        RagIndexProgress {
            doc_id: doc_id.clone(),
            stage: "extracting".to_string(),
            current_page: 0,
            total_pages: 0,
            processed_chunks: 0,
            total_chunks: 0,
            percent: 1,
        },
    );

    // 1. Extract text, validate against scanned PDFs, filter junk, and chunk inside spawn_blocking
    let app_for_extract = app.clone();
    let doc_id_for_extract = doc_id.clone();
    let path_buf = PathBuf::from(&file_path);

    let (prepared_chunks, total_pages) = tauri::async_runtime::spawn_blocking(move || {
        pdf_text::extract_and_chunk_pdf(
            &path_buf,
            &doc_id_for_extract,
            ranges.as_deref(),
            &config,
            |stage, current_page, total_pages, processed_chunks, total_chunks, percent| {
                let _ = app_for_extract.emit(
                    "rag_index_progress",
                    RagIndexProgress {
                        doc_id: doc_id_for_extract.clone(),
                        stage: stage.to_string(),
                        current_page,
                        total_pages,
                        processed_chunks,
                        total_chunks,
                        percent,
                    },
                );
            },
        )
    })
    .await
    .map_err(|e| format!("PDF extraction worker panicked: {:?}", e))??;

    let total_chunks = prepared_chunks.len();
    let texts: Vec<String> = prepared_chunks.iter().map(|c| c.text.clone()).collect();

    // 2. Embed chunks (length-sorted ONNX batches or batched remote API calls)
    let _ = app.emit(
        "rag_index_progress",
        RagIndexProgress {
            doc_id: doc_id.clone(),
            stage: "embedding".to_string(),
            current_page: total_pages,
            total_pages,
            processed_chunks: 0,
            total_chunks,
            percent: 40,
        },
    );

    let vectors = embedder::embed_documents(
        &state,
        &embedding_config,
        &texts,
        |processed_chunks, total_chunks| {
            let emb_pct = if total_chunks > 0 {
                40 + ((processed_chunks as f32 / total_chunks as f32) * 52.0).round() as u8
            } else {
                92
            };
            let _ = app.emit(
                "rag_index_progress",
                RagIndexProgress {
                    doc_id: doc_id.clone(),
                    stage: "embedding".to_string(),
                    current_page: total_pages,
                    total_pages,
                    processed_chunks,
                    total_chunks,
                    percent: emb_pct.min(94),
                },
            );
        },
    )
    .await?;

    let dimensions = vectors
        .first()
        .map(|v| v.len())
        .ok_or_else(|| "Embedding returned zero vectors.".to_string())?;

    // 3. Persist chunks & normalized f32 BLOBs inside a single SQLite transaction
    let _ = app.emit(
        "rag_index_progress",
        RagIndexProgress {
            doc_id: doc_id.clone(),
            stage: "saving".to_string(),
            current_page: total_pages,
            total_pages,
            processed_chunks: total_chunks,
            total_chunks,
            percent: 96,
        },
    );

    let rows: Vec<ChunkInsertRow> = prepared_chunks
        .into_iter()
        .zip(vectors.into_iter())
        .map(|(chunk, embedding)| ChunkInsertRow {
            chunk_id: chunk.chunk_id,
            page_number: chunk.page_number,
            chunk_index: chunk.chunk_index,
            text: chunk.text,
            embedding,
        })
        .collect();

    let db_path = state.db_path.clone();
    let doc_id_db = doc_id.clone();
    let emb_model = embedding_config.model.clone();
    let emb_provider = embedding_config.provider.clone();

    tauri::async_runtime::spawn_blocking(move || {
        db::replace_document_index(
            &db_path,
            &doc_id_db,
            &doc_title,
            &file_path,
            &emb_model,
            &emb_provider,
            dimensions,
            &rows,
        )
    })
    .await
    .map_err(|e| format!("Database write worker panicked: {:?}", e))??;

    let _ = app.emit(
        "rag_index_progress",
        RagIndexProgress {
            doc_id,
            stage: "saving".to_string(),
            current_page: total_pages,
            total_pages,
            processed_chunks: total_chunks,
            total_chunks,
            percent: 100,
        },
    );

    Ok(IndexDocumentResult {
        chunk_count: total_chunks,
    })
}

#[tauri::command]
pub async fn rag_remove_document_index(
    state: State<'_, RagState>,
    doc_id: String,
) -> Result<(), String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::remove_document_index(&db_path, &doc_id))
        .await
        .map_err(|e| format!("Worker panicked: {:?}", e))?
}

#[tauri::command]
pub async fn rag_get_catalog(state: State<'_, RagState>) -> Result<RagCatalog, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::get_catalog(&db_path))
        .await
        .map_err(|e| format!("Worker panicked: {:?}", e))?
}

#[tauri::command]
pub async fn rag_get_document_chunks(
    state: State<'_, RagState>,
    doc_id: String,
) -> Result<Vec<DocumentChunk>, String> {
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || db::get_document_chunks(&db_path, &doc_id))
        .await
        .map_err(|e| format!("Worker panicked: {:?}", e))?
}

#[tauri::command]
pub async fn rag_search(
    state: State<'_, RagState>,
    query: RagSearchQuery,
    embedding_config: EmbeddingConfig,
) -> Result<Vec<RagSearchResult>, String> {
    let clean_query = query.query.trim();
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    let top_k = query.top_k.unwrap_or(5).max(1);
    let threshold = query.similarity_threshold.unwrap_or(0.65);
    let target_doc_id = query.target_doc_id.clone().filter(|s| !s.is_empty());

    // If searching a specific document, verify model/dimension compatibility clearly
    if let Some(ref doc_id) = target_doc_id {
        let db_path = state.db_path.clone();
        let doc_id_clone = doc_id.clone();
        let doc_meta = tauri::async_runtime::spawn_blocking(move || {
            db::get_document_embedding_info(&db_path, &doc_id_clone)
        })
        .await
        .map_err(|e| format!("Worker panicked: {:?}", e))??;

        let Some((_indexed_provider, indexed_model, _indexed_dim)) = doc_meta else {
            return Ok(Vec::new());
        };

        if indexed_model != embedding_config.model {
            return Err(format!(
                "This PDF was indexed with '{}', but the active embedding model is '{}'. Re-index this PDF or switch models.",
                indexed_model, embedding_config.model
            ));
        }
    }

    let query_vec = embedder::embed_query(&state, &embedding_config, clean_query).await?;
    let query_dim = query_vec.len();

    let db_path = state.db_path.clone();
    let model_name = embedding_config.model.clone();
    let candidates = tauri::async_runtime::spawn_blocking(move || {
        db::load_candidate_vectors(&db_path, target_doc_id.as_deref(), &model_name, query_dim)
    })
    .await
    .map_err(|e| format!("Worker panicked: {:?}", e))??;

    let mut scored: Vec<RagSearchResult> = candidates
        .into_iter()
        .filter_map(|row| {
            let score = dot_product_le_bytes(&query_vec, &row.embedding_bytes);
            if score >= threshold {
                Some(RagSearchResult {
                    chunk_id: row.chunk_id,
                    doc_id: row.doc_id,
                    doc_title: row.doc_title,
                    page_number: row.page_number,
                    text: row.text,
                    similarity_score: (score * 1000.0).round() / 1000.0,
                })
            } else {
                None
            }
        })
        .collect();

    scored.sort_by(|a, b| b.similarity_score.total_cmp(&a.similarity_score));
    scored.truncate(top_k);
    Ok(scored)
}
