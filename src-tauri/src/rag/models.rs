use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConfig {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingScope {
    pub doc_id: String,
    pub doc_title: String,
    pub file_path: String,
    #[serde(default)]
    pub selected_page_ranges: Option<Vec<[usize; 2]>>,
}

fn default_chunk_size() -> usize {
    32
}

fn default_chunk_overlap() -> usize {
    6
}

fn default_similarity_threshold() -> f32 {
    0.65
}

fn default_top_k() -> usize {
    5
}

fn default_max_tokens() -> usize {
    1024
}

fn default_vector_dimension() -> usize {
    384
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagHyperparameters {
    #[serde(alias = "chunkSizeLines", default = "default_chunk_size")]
    pub chunk_size: usize,
    #[serde(alias = "overlapLines", default = "default_chunk_overlap")]
    pub chunk_overlap: usize,
    #[serde(default = "default_similarity_threshold")]
    pub similarity_threshold: f32,
    #[serde(default = "default_top_k")]
    pub top_k: usize,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: usize,
    #[serde(default = "default_vector_dimension")]
    pub vector_dimension: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexProgress {
    pub doc_id: String,
    pub stage: String, // "extracting" | "chunking" | "embedding" | "saving"
    pub current_page: usize,
    pub total_pages: usize,
    pub processed_chunks: usize,
    pub total_chunks: usize,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub model_id: String,
    pub is_available: bool,
    pub is_downloading: bool,
    pub file_size_mb: f64,
    pub provider: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub percent: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub is_complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedModelInfo {
    pub model_id: String,
    pub file_size_mb: f64,
    pub dir_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDocumentResult {
    pub chunk_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub doc_id: String,
    pub doc_title: String,
    pub file_path: String,
    pub chunk_count: usize,
    pub embedding_model: String,
    pub provider: String,
    pub indexed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagCatalog {
    pub documents: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentChunk {
    pub chunk_id: String,
    pub page_number: usize,
    pub chunk_index: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchQuery {
    pub query: String,
    #[serde(default)]
    pub top_k: Option<usize>,
    #[serde(default)]
    pub target_doc_id: Option<String>,
    #[serde(default)]
    pub similarity_threshold: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagSearchResult {
    pub chunk_id: String,
    pub doc_id: String,
    pub doc_title: String,
    pub page_number: usize,
    pub text: String,
    pub similarity_score: f32,
}
