use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::Duration;

use ndarray::Array2;
use ort::session::{Session, builder::GraphOptimizationLevel};
use ort::value::Tensor;
use serde::{Deserialize, Serialize};
use tokenizers::{PaddingParams, Tokenizer, TruncationParams};

use super::downloader::resolve_downloaded_files;
use super::model_configs::{PoolingStrategy, ResolvedModelConfig, resolve_local_model_config};
use super::models::EmbeddingConfig;
use super::{LoadedLocalModel, RagState};

const LOCAL_BATCH_SIZE: usize = 24;
const REMOTE_BATCH_SIZE: usize = 64;

static ORT_ENV: OnceLock<ort::environment::Environment> = OnceLock::new();
static ORT_ENV_INIT_LOCK: StdMutex<()> = StdMutex::new(());

fn get_ort_env() -> Result<&'static ort::environment::Environment, String> {
    if let Some(env) = ORT_ENV.get() {
        return Ok(env);
    }
    let _init_guard = ORT_ENV_INIT_LOCK
        .lock()
        .map_err(|e| format!("ONNX Runtime env lock poisoned: {}", e))?;
    if let Some(env) = ORT_ENV.get() {
        return Ok(env);
    }
    let env = ort::init()
        .with_name("foliet-rag")
        .build()
        .map_err(|e| format!("Failed to initialize ONNX Runtime environment: {}", e))?;
    let _ = ORT_ENV.set(env);
    ORT_ENV
        .get()
        .ok_or_else(|| "Failed to retrieve initialized ONNX Runtime environment".to_string())
}

pub fn l2_normalize(vec: &mut [f32]) {
    let norm_sq: f32 = vec.iter().map(|v| v * v).sum();
    let norm = norm_sq.sqrt();
    if norm > 1e-12 {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }
}

fn ensure_local_model_loaded<'a>(
    guard: &'a mut Option<LoadedLocalModel>,
    state: &RagState,
    model_id: &str,
) -> Result<&'a mut LoadedLocalModel, String> {
    let resolved_cfg = resolve_local_model_config(model_id);
    let already_loaded = guard
        .as_ref()
        .is_some_and(|m| m.model_id == model_id || m.config.hf_repo_id == resolved_cfg.hf_repo_id);

    if !already_loaded {
        let (onnx_path, tok_path) = resolve_downloaded_files(&state.models_dir, model_id)
            .ok_or_else(|| {
                format!(
                    "Local embedding model '{}' is not downloaded. Download it in RAG Search settings first.",
                    model_id
                )
            })?;

        let threads = std::thread::available_parallelism()
            .map(|n| n.get().min(8))
            .unwrap_or(4);

        let env = get_ort_env()?;

        let session = Session::builder(env)
            .map_err(|e| format!("Failed to create ONNX session builder: {}", e))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("Failed to set ONNX optimization level: {}", e))?
            .with_intra_threads(threads)
            .map_err(|e| format!("Failed to set ONNX threads: {}", e))?
            .commit_from_file(&onnx_path)
            .map_err(|e| format!("Failed to load ONNX file '{}': {}", onnx_path.display(), e))?;

        let mut tokenizer = Tokenizer::from_file(&tok_path)
            .map_err(|e| format!("Failed to load tokenizer '{}': {}", tok_path.display(), e))?;

        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: resolved_cfg.max_length,
                ..Default::default()
            }))
            .map_err(|e| format!("Failed to configure tokenizer truncation: {}", e))?;

        tokenizer.with_padding(Some(PaddingParams::default()));

        *guard = Some(LoadedLocalModel {
            model_id: model_id.to_string(),
            session,
            tokenizer,
            config: resolved_cfg,
        });
    }

    guard
        .as_mut()
        .ok_or_else(|| "Failed to initialize cached local model".to_string())
}

fn run_onnx_batch(
    loaded: &mut LoadedLocalModel,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let encodings = loaded
        .tokenizer
        .encode_batch(texts.to_vec(), true)
        .map_err(|e| format!("Tokenizer batch encoding failed: {}", e))?;

    let batch_size = encodings.len();
    let seq_len = encodings.first().map(|e| e.get_ids().len()).unwrap_or(0);
    if seq_len == 0 {
        return Err("Tokenizer produced empty sequence length".to_string());
    }

    let mut input_ids = Vec::with_capacity(batch_size * seq_len);
    let mut attention_mask = Vec::with_capacity(batch_size * seq_len);
    let mut token_type_ids = Vec::with_capacity(batch_size * seq_len);

    for enc in &encodings {
        input_ids.extend(enc.get_ids().iter().map(|&id| id as i64));
        attention_mask.extend(enc.get_attention_mask().iter().map(|&m| m as i64));
        token_type_ids.extend(enc.get_type_ids().iter().map(|&t| t as i64));
    }

    let ids_arr = Array2::from_shape_vec((batch_size, seq_len), input_ids)
        .map_err(|e| format!("input_ids ndarray error: {}", e))?;
    let mask_arr = Array2::from_shape_vec((batch_size, seq_len), attention_mask.clone())
        .map_err(|e| format!("attention_mask ndarray error: {}", e))?;

    let needs_type_ids = loaded
        .session
        .inputs()
        .iter()
        .any(|input| input.name() == "token_type_ids");

    let outputs = if needs_type_ids {
        let type_arr = Array2::from_shape_vec((batch_size, seq_len), token_type_ids)
            .map_err(|e| format!("token_type_ids ndarray error: {}", e))?;
        loaded
            .session
            .run(ort::inputs![
                "input_ids" => Tensor::from_array(ids_arr).map_err(|e| e.to_string())?,
                "attention_mask" => Tensor::from_array(mask_arr).map_err(|e| e.to_string())?,
                "token_type_ids" => Tensor::from_array(type_arr).map_err(|e| e.to_string())?,
            ])
            .map_err(|e| format!("ONNX inference failed: {}", e))?
    } else {
        loaded
            .session
            .run(ort::inputs![
                "input_ids" => Tensor::from_array(ids_arr).map_err(|e| e.to_string())?,
                "attention_mask" => Tensor::from_array(mask_arr).map_err(|e| e.to_string())?,
            ])
            .map_err(|e| format!("ONNX inference failed: {}", e))?
    };

    let (_name, out_val) = outputs
        .iter()
        .next()
        .ok_or_else(|| "ONNX session produced no output tensors".to_string())?;

    let (shape, data) = out_val
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("Failed to extract f32 output tensor: {}", e))?;

    let dims: Vec<usize> = shape.iter().map(|&d| d as usize).collect();
    let data_slice: &[f32] = data;
    let mut pooled: Vec<Vec<f32>> = Vec::with_capacity(batch_size);

    if dims.len() == 2 && dims[0] == batch_size {
        let hidden = dims[1];
        for b in 0..batch_size {
            let start = b * hidden;
            let mut vec: Vec<f32> = (&data_slice[start..start + hidden]).to_vec();
            if loaded.config.normalize {
                l2_normalize(&mut vec);
            }
            pooled.push(vec);
        }
    } else if dims.len() == 3 && dims[0] == batch_size {
        let out_seq = dims[1];
        let hidden = dims[2];

        for b in 0..batch_size {
            let mut vec: Vec<f32> = vec![0.0f32; hidden];
            match loaded.config.pooling {
                PoolingStrategy::Cls => {
                    let start = b * out_seq * hidden;
                    vec.copy_from_slice(&data_slice[start..start + hidden]);
                }
                PoolingStrategy::Mean => {
                    let mut mask_sum = 0.0f32;
                    for t in 0..out_seq.min(seq_len) {
                        let m = attention_mask[b * seq_len + t] as f32;
                        if m > 0.0 {
                            mask_sum += m;
                            let offset = (b * out_seq + t) * hidden;
                            for h in 0..hidden {
                                vec[h] += data_slice[offset + h] * m;
                            }
                        }
                    }
                    let denom = mask_sum.max(1.0);
                    for v in &mut vec {
                        *v /= denom;
                    }
                }
            }
            if loaded.config.normalize {
                l2_normalize(&mut vec);
            }
            pooled.push(vec);
        }
    } else {
        return Err(format!("Unsupported ONNX output tensor shape: {:?}", dims));
    }

    Ok(pooled)
}

async fn embed_local_texts<F>(
    state: &RagState,
    model_id: &str,
    texts: &[String],
    is_query: bool,
    mut on_progress: F,
) -> Result<Vec<Vec<f32>>, String>
where
    F: FnMut(usize, usize),
{
    let total = texts.len();
    if total == 0 {
        return Ok(Vec::new());
    }

    let cfg: ResolvedModelConfig = resolve_local_model_config(model_id);
    let prefix = if is_query {
        cfg.query_prefix
    } else {
        cfg.doc_prefix
    };

    // Length-sorted indices minimize padding waste in CPU ONNX batches
    let mut indexed: Vec<(usize, String)> = texts
        .iter()
        .enumerate()
        .map(|(i, t)| {
            if prefix.is_empty() {
                (i, t.clone())
            } else {
                (i, format!("{}{}", prefix, t))
            }
        })
        .collect();

    if total > 1 {
        indexed.sort_by_key(|(_, t)| t.len());
    }

    let mut result = vec![Vec::new(); total];
    let mut processed = 0usize;

    let mut guard = state.loaded_model.lock().await;
    let loaded = ensure_local_model_loaded(&mut guard, state, model_id)?;

    for batch in indexed.chunks(LOCAL_BATCH_SIZE) {
        let batch_texts: Vec<String> = batch.iter().map(|(_, t)| t.clone()).collect();
        let vectors = run_onnx_batch(loaded, &batch_texts)?;

        for ((orig_idx, _), vec) in batch.iter().zip(vectors.into_iter()) {
            result[*orig_idx] = vec;
        }

        processed += batch.len();
        on_progress(processed, total);
    }

    Ok(result)
}

#[derive(Serialize)]
struct OpenAiEmbedRequest<'a> {
    model: &'a str,
    input: &'a [String],
}

#[derive(Serialize)]
struct VoyageEmbedRequest<'a> {
    model: &'a str,
    input: &'a [String],
    input_type: &'a str,
}

#[derive(Deserialize)]
struct EmbedItem {
    embedding: Vec<f32>,
    #[serde(default)]
    index: Option<usize>,
}

#[derive(Deserialize)]
struct OpenAiVoyageEmbedResponse {
    data: Vec<EmbedItem>,
}

#[derive(Deserialize)]
struct OllamaEmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

async fn send_with_retry<F, Fut>(mut make_req: F) -> Result<reqwest::Response, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    let delays = [400u64, 1200u64];
    for attempt in 0..=delays.len() {
        match make_req().await {
            Ok(resp) => {
                let status = resp.status();
                if status.is_success() {
                    return Ok(resp);
                }
                let retryable = status.as_u16() == 429 || status.is_server_error();
                let body = resp.text().await.unwrap_or_default();
                if retryable && attempt < delays.len() {
                    tokio::time::sleep(Duration::from_millis(delays[attempt])).await;
                    continue;
                }
                return Err(format!("Embedding API error ({}): {}", status, body));
            }
            Err(err) => {
                if attempt < delays.len() {
                    tokio::time::sleep(Duration::from_millis(delays[attempt])).await;
                    continue;
                }
                return Err(format!("Embedding HTTP request failed: {}", err));
            }
        }
    }
    Err("Embedding request exhausted retries".to_string())
}

async fn embed_remote_texts<F>(
    state: &RagState,
    config: &EmbeddingConfig,
    texts: &[String],
    is_query: bool,
    mut on_progress: F,
) -> Result<Vec<Vec<f32>>, String>
where
    F: FnMut(usize, usize),
{
    let total = texts.len();
    if total == 0 {
        return Ok(Vec::new());
    }

    let provider = config.provider.as_str();
    let api_key = config.api_key.as_deref().unwrap_or("").trim();

    if matches!(provider, "voyage" | "openai") && api_key.is_empty() {
        return Err(format!(
            "An API key is required for '{}' embeddings.",
            provider
        ));
    }

    let batch_size = if provider == "ollama" {
        32
    } else {
        REMOTE_BATCH_SIZE
    };
    let mut all_vectors = Vec::with_capacity(total);
    let mut processed = 0usize;

    for batch in texts.chunks(batch_size) {
        let mut batch_vecs: Vec<Vec<f32>> = match provider {
            "voyage" => {
                let input_type = if is_query { "query" } else { "document" };
                let resp = send_with_retry(|| {
                    state
                        .http_client
                        .post("https://api.voyageai.com/v1/embeddings")
                        .bearer_auth(api_key)
                        .json(&VoyageEmbedRequest {
                            model: &config.model,
                            input: batch,
                            input_type,
                        })
                        .send()
                })
                .await?;

                let mut parsed: OpenAiVoyageEmbedResponse = resp
                    .json()
                    .await
                    .map_err(|e| format!("Invalid Voyage response: {}", e))?;
                parsed.data.sort_by_key(|d| d.index.unwrap_or(0));
                parsed.data.into_iter().map(|d| d.embedding).collect()
            }
            "openai" => {
                let resp = send_with_retry(|| {
                    state
                        .http_client
                        .post("https://api.openai.com/v1/embeddings")
                        .bearer_auth(api_key)
                        .json(&OpenAiEmbedRequest {
                            model: &config.model,
                            input: batch,
                        })
                        .send()
                })
                .await?;

                let mut parsed: OpenAiVoyageEmbedResponse = resp
                    .json()
                    .await
                    .map_err(|e| format!("Invalid OpenAI response: {}", e))?;
                parsed.data.sort_by_key(|d| d.index.unwrap_or(0));
                parsed.data.into_iter().map(|d| d.embedding).collect()
            }
            "ollama" => {
                let base = config
                    .endpoint
                    .as_deref()
                    .unwrap_or("http://localhost:11434")
                    .trim_end_matches('/');
                let url = format!("{}/api/embed", base);

                let resp = send_with_retry(|| {
                    state
                        .http_client
                        .post(&url)
                        .json(&OpenAiEmbedRequest {
                            model: &config.model,
                            input: batch,
                        })
                        .send()
                })
                .await?;

                let parsed: OllamaEmbedResponse = resp
                    .json()
                    .await
                    .map_err(|e| format!("Invalid Ollama response: {}", e))?;
                parsed.embeddings
            }
            other => {
                return Err(format!("Unsupported embedding provider: '{}'", other));
            }
        };

        if batch_vecs.len() != batch.len() {
            return Err(format!(
                "Embedding API returned {} vectors for {} inputs",
                batch_vecs.len(),
                batch.len()
            ));
        }

        for vec in &mut batch_vecs {
            l2_normalize(vec);
        }

        all_vectors.extend(batch_vecs);
        processed += batch.len();
        on_progress(processed, total);
    }

    Ok(all_vectors)
}

pub async fn embed_documents<F>(
    state: &RagState,
    config: &EmbeddingConfig,
    texts: &[String],
    on_progress: F,
) -> Result<Vec<Vec<f32>>, String>
where
    F: FnMut(usize, usize),
{
    if config.provider == "local-rust" {
        embed_local_texts(state, &config.model, texts, false, on_progress).await
    } else {
        embed_remote_texts(state, config, texts, false, on_progress).await
    }
}

pub async fn embed_query(
    state: &RagState,
    config: &EmbeddingConfig,
    query: &str,
) -> Result<Vec<f32>, String> {
    let inputs = vec![query.to_string()];
    let mut vecs = if config.provider == "local-rust" {
        embed_local_texts(state, &config.model, &inputs, true, |_, _| {}).await?
    } else {
        embed_remote_texts(state, config, &inputs, true, |_, _| {}).await?
    };

    vecs.pop()
        .ok_or_else(|| "Failed to produce query embedding".to_string())
}
