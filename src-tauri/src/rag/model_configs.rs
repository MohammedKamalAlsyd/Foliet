use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PoolingStrategy {
    Mean,
    Cls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedModelConfig {
    /// Original model ID requested by the user/UI
    pub requested_id: String,
    /// Hugging Face repository ID (e.g., "Xenova/gte-small")
    pub hf_repo_id: String,
    /// Candidate ONNX paths inside the HF repo, ordered fastest/quantized first
    pub onnx_candidates: Vec<&'static str>,
    pub tokenizer_file: &'static str,
    pub pooling: PoolingStrategy,
    pub max_length: usize,
    pub query_prefix: &'static str,
    pub doc_prefix: &'static str,
    pub normalize: bool,
}

const DEFAULT_ONNX_CANDIDATES: &[&str] = &[
    "onnx/model_quantized.onnx",
    "onnx/model_int8.onnx",
    "onnx/model.onnx",
    "model_quantized.onnx",
    "model.onnx",
];

/// Resolves per-model tuned parameters or falls back cleanly for any custom HF repo ID.
pub fn resolve_local_model_config(model_id: &str) -> ResolvedModelConfig {
    let trimmed = model_id.trim();

    match trimmed {
        // Default GTE Small (supports legacy "thenlper/gte-small" saved settings via Xenova ONNX repo)
        "Xenova/gte-small" | "thenlper/gte-small" => ResolvedModelConfig {
            requested_id: trimmed.to_string(),
            hf_repo_id: "Xenova/gte-small".to_string(),
            onnx_candidates: DEFAULT_ONNX_CANDIDATES.to_vec(),
            tokenizer_file: "tokenizer.json",
            pooling: PoolingStrategy::Mean,
            max_length: 512,
            query_prefix: "",
            doc_prefix: "",
            normalize: true,
        },

        // Default BGE Small EN v1.5 (uses BGE retrieval query instruction + CLS pooling)
        "Xenova/bge-small-en-v1.5" | "BAAI/bge-small-en-v1.5" => ResolvedModelConfig {
            requested_id: trimmed.to_string(),
            hf_repo_id: "Xenova/bge-small-en-v1.5".to_string(),
            onnx_candidates: DEFAULT_ONNX_CANDIDATES.to_vec(),
            tokenizer_file: "tokenizer.json",
            pooling: PoolingStrategy::Cls,
            max_length: 512,
            query_prefix: "Represent this sentence for searching relevant passages: ",
            doc_prefix: "",
            normalize: true,
        },

        // BGE Base / Large presets if typed manually
        "Xenova/bge-base-en-v1.5" | "Xenova/bge-large-en-v1.5" => ResolvedModelConfig {
            requested_id: trimmed.to_string(),
            hf_repo_id: trimmed.to_string(),
            onnx_candidates: DEFAULT_ONNX_CANDIDATES.to_vec(),
            tokenizer_file: "tokenizer.json",
            pooling: PoolingStrategy::Cls,
            max_length: 512,
            query_prefix: "Represent this sentence for searching relevant passages: ",
            doc_prefix: "",
            normalize: true,
        },

        // E5 family presets if typed manually
        id if id.contains("e5-") => ResolvedModelConfig {
            requested_id: trimmed.to_string(),
            hf_repo_id: trimmed.to_string(),
            onnx_candidates: DEFAULT_ONNX_CANDIDATES.to_vec(),
            tokenizer_file: "tokenizer.json",
            pooling: PoolingStrategy::Mean,
            max_length: 512,
            query_prefix: "query: ",
            doc_prefix: "passage: ",
            normalize: true,
        },

        // Dynamic fallback for any custom Hugging Face ONNX repository ID
        _ => ResolvedModelConfig {
            requested_id: trimmed.to_string(),
            hf_repo_id: trimmed.to_string(),
            onnx_candidates: DEFAULT_ONNX_CANDIDATES.to_vec(),
            tokenizer_file: "tokenizer.json",
            pooling: PoolingStrategy::Mean,
            max_length: 512,
            query_prefix: "",
            doc_prefix: "",
            normalize: true,
        },
    }
}

/// Sanitizes a model ID into a safe folder name under `<app_data_dir>/rag_models/`.
pub fn sanitize_model_dir_name(model_id: &str) -> String {
    let mut out = String::with_capacity(model_id.len());
    for ch in model_id.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let cleaned = out.trim_matches('.').to_string();
    if cleaned.is_empty() {
        "custom_model".to_string()
    } else {
        cleaned
    }
}
