use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use super::RagState;
use super::model_configs::{resolve_local_model_config, sanitize_model_dir_name};
use super::models::{DownloadedModelInfo, ModelDownloadProgress, ModelStatus};

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalModelMeta {
    pub model_id: String,
    pub hf_repo_id: String,
    pub onnx_filename: String,
    pub tokenizer_filename: String,
}

pub fn model_dir_for(models_dir: &Path, model_id: &str) -> PathBuf {
    models_dir.join(sanitize_model_dir_name(model_id))
}

/// Finds the downloaded ONNX + tokenizer files inside `<models_dir>/<sanitized>/`.
pub fn resolve_downloaded_files(models_dir: &Path, model_id: &str) -> Option<(PathBuf, PathBuf)> {
    let dir = model_dir_for(models_dir, model_id);
    if !dir.is_dir() {
        return None;
    }

    let meta_path = dir.join("meta.json");
    if let Ok(raw) = std::fs::read_to_string(&meta_path) {
        if let Ok(meta) = serde_json::from_str::<LocalModelMeta>(&raw) {
            let onnx = dir.join(&meta.onnx_filename);
            let tok = dir.join(&meta.tokenizer_filename);
            if onnx.is_file() && tok.is_file() {
                return Some((onnx, tok));
            }
        }
    }

    // Fallback check if meta.json is absent
    let tok = dir.join("tokenizer.json");
    if !tok.is_file() {
        return None;
    }

    let onnx_candidates = ["model_quantized.onnx", "model_int8.onnx", "model.onnx"];
    for cand in onnx_candidates {
        let p = dir.join(cand);
        if p.is_file() {
            return Some((p, tok));
        }
    }
    None
}

pub fn dir_size_bytes(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        } else if p.is_dir() {
            total += dir_size_bytes(&p);
        }
    }
    total
}

pub fn get_local_model_status(state: &RagState, provider: &str, model_id: &str) -> ModelStatus {
    if provider != "local-rust" {
        return ModelStatus {
            model_id: model_id.to_string(),
            is_available: true,
            is_downloading: false,
            file_size_mb: 0.0,
            provider: provider.to_string(),
        };
    }

    let dir = model_dir_for(&state.models_dir, model_id);
    let is_available = resolve_downloaded_files(&state.models_dir, model_id).is_some();
    let size_mb = if is_available {
        let bytes = dir_size_bytes(&dir);
        ((bytes as f64 / (1024.0 * 1024.0)) * 10.0).round() / 10.0
    } else {
        0.0
    };

    ModelStatus {
        model_id: model_id.to_string(),
        is_available,
        is_downloading: false,
        file_size_mb: size_mb,
        provider: provider.to_string(),
    }
}

pub fn list_downloaded_models(state: &RagState) -> Result<Vec<DownloadedModelInfo>, String> {
    let entries = std::fs::read_dir(&state.models_dir)
        .map_err(|e| format!("Failed to read rag_models dir: {}", e))?;

    let mut list = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        let bytes = dir_size_bytes(&path);
        let size_mb = ((bytes as f64 / (1024.0 * 1024.0)) * 10.0).round() / 10.0;

        let model_id = std::fs::read_to_string(path.join("meta.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<LocalModelMeta>(&raw).ok())
            .map(|m| m.model_id)
            .unwrap_or_else(|| dir_name.clone());

        list.push(DownloadedModelInfo {
            model_id,
            file_size_mb: size_mb,
            dir_name,
        });
    }

    list.sort_by(|a, b| a.model_id.cmp(&b.model_id));
    Ok(list)
}

async fn stream_file_atomic(
    client: &reqwest::Client,
    url: &str,
    dest_path: &Path,
    app: &AppHandle,
    model_id: &str,
    base_downloaded: u64,
    estimated_total: u64,
) -> Result<u64, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Network request failed for {}: {}", url, e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), url));
    }

    let content_len = resp.content_length().unwrap_or(0);
    let total_bytes = base_downloaded + content_len.max(estimated_total);

    let temp_path = dest_path.with_extension("part");
    let mut file = tokio::fs::File::create(&temp_path).await.map_err(|e| {
        format!(
            "Failed to create temp file '{}': {}",
            temp_path.display(),
            e
        )
    })?;

    let mut stream = resp.bytes_stream();
    let mut file_downloaded: u64 = 0;
    let mut last_emitted_percent: i16 = -1;

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Stream read error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Temp file write error: {}", e))?;

        file_downloaded += chunk.len() as u64;
        let current_total = base_downloaded + file_downloaded;
        let percent = if total_bytes > 0 {
            ((current_total as f64 / total_bytes as f64) * 99.0).clamp(1.0, 99.0) as u8
        } else {
            50
        };

        if (percent as i16) > last_emitted_percent {
            last_emitted_percent = percent as i16;
            let _ = app.emit(
                "rag_model_download_progress",
                ModelDownloadProgress {
                    model_id: model_id.to_string(),
                    percent,
                    downloaded_bytes: current_total,
                    total_bytes,
                    is_complete: false,
                    error: None,
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush downloaded file: {}", e))?;
    drop(file);

    if dest_path.exists() {
        let _ = tokio::fs::remove_file(dest_path).await;
    }
    tokio::fs::rename(&temp_path, dest_path)
        .await
        .map_err(|e| format!("Failed to finalize '{}': {}", dest_path.display(), e))?;

    Ok(file_downloaded)
}

pub async fn download_local_model(
    app: &AppHandle,
    state: &RagState,
    model_id: &str,
) -> Result<(), String> {
    let config = resolve_local_model_config(model_id);
    let model_dir = model_dir_for(&state.models_dir, model_id);
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| format!("Failed to create model directory: {}", e))?;

    let hf_base = format!("https://huggingface.co/{}/resolve/main", config.hf_repo_id);

    // 1. Download tokenizer.json
    let tok_url = format!("{}/{}", hf_base, config.tokenizer_file);
    let tok_dest = model_dir.join("tokenizer.json");
    let tok_bytes = match stream_file_atomic(
        &state.http_client,
        &tok_url,
        &tok_dest,
        app,
        model_id,
        0,
        1_000_000,
    )
    .await
    {
        Ok(b) => b,
        Err(e) => {
            let _ = app.emit(
                "rag_model_download_progress",
                ModelDownloadProgress {
                    model_id: model_id.to_string(),
                    percent: 0,
                    downloaded_bytes: 0,
                    total_bytes: 0,
                    is_complete: false,
                    error: Some(e.clone()),
                },
            );
            return Err(e);
        }
    };

    // 2. Probe ONNX candidates in priority order (quantized first)
    let mut selected_onnx_name: Option<String> = None;
    let mut onnx_bytes: u64 = 0;
    let mut last_err = String::from("No ONNX candidate found in repository");

    for candidate in &config.onnx_candidates {
        let url = format!("{}/{}", hf_base, candidate);
        let head = state.http_client.head(&url).send().await;
        let is_reachable = head.as_ref().is_ok_and(|r| r.status().is_success());

        if !is_reachable {
            last_err = format!("Candidate {} not available", candidate);
            continue;
        }

        let local_name = Path::new(candidate)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("model.onnx")
            .to_string();
        let dest = model_dir.join(&local_name);

        match stream_file_atomic(&state.http_client, &url, &dest, app, model_id, tok_bytes, 0).await
        {
            Ok(bytes) => {
                onnx_bytes = bytes;
                selected_onnx_name = Some(local_name);
                break;
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    let Some(onnx_filename) = selected_onnx_name else {
        let msg = format!(
            "Failed to download ONNX weights for '{}': {}",
            config.hf_repo_id, last_err
        );
        let _ = app.emit(
            "rag_model_download_progress",
            ModelDownloadProgress {
                model_id: model_id.to_string(),
                percent: 0,
                downloaded_bytes: tok_bytes,
                total_bytes: tok_bytes,
                is_complete: false,
                error: Some(msg.clone()),
            },
        );
        return Err(msg);
    };

    // 3. Persist meta.json for exact model identification & size reporting
    let meta = LocalModelMeta {
        model_id: model_id.to_string(),
        hf_repo_id: config.hf_repo_id,
        onnx_filename,
        tokenizer_filename: "tokenizer.json".to_string(),
    };
    let meta_json = serde_json::to_string_pretty(&meta)
        .map_err(|e| format!("Failed to serialize model meta: {}", e))?;
    tokio::fs::write(model_dir.join("meta.json"), meta_json)
        .await
        .map_err(|e| format!("Failed to write meta.json: {}", e))?;

    let total = tok_bytes + onnx_bytes;
    let _ = app.emit(
        "rag_model_download_progress",
        ModelDownloadProgress {
            model_id: model_id.to_string(),
            percent: 100,
            downloaded_bytes: total,
            total_bytes: total,
            is_complete: true,
            error: None,
        },
    );

    Ok(())
}

/// Drops any cached ONNX session for `model_id` first (Windows file-lock safety),
/// then deletes `<app_data_dir>/rag_models/<sanitized_model_id>/`.
pub async fn delete_local_model(state: &RagState, model_id: &str) -> Result<(), String> {
    let target_cfg = resolve_local_model_config(model_id);
    let target_dir = model_dir_for(&state.models_dir, model_id);

    // Hold lock while clearing session & removing directory to prevent reload races
    let mut guard = state.loaded_model.lock().await;
    if let Some(loaded) = guard.as_ref() {
        if loaded.model_id == model_id || loaded.config.hf_repo_id == target_cfg.hf_repo_id {
            *guard = None;
        }
    }

    if target_dir.exists() {
        tokio::fs::remove_dir_all(&target_dir).await.map_err(|e| {
            format!(
                "Failed to remove model directory '{}': {}",
                target_dir.display(),
                e
            )
        })?;
    }

    Ok(())
}
