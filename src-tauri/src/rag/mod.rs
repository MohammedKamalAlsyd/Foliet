pub mod commands;
pub mod db;
pub mod downloader;
pub mod embedder;
pub mod model_configs;
pub mod models;
pub mod pdf_text;

use ort::session::Session;
use std::path::PathBuf;
use tokenizers::Tokenizer;
use tokio::sync::Mutex;

use model_configs::ResolvedModelConfig;

pub struct LoadedLocalModel {
    pub model_id: String,
    pub session: Session,
    pub tokenizer: Tokenizer,
    pub config: ResolvedModelConfig,
}

pub struct RagState {
    pub db_path: PathBuf,
    pub models_dir: PathBuf,
    pub http_client: reqwest::Client,
    pub loaded_model: Mutex<Option<LoadedLocalModel>>,
}

impl RagState {
    pub fn init(app_data_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;

        let models_dir = app_data_dir.join("rag_models");
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create rag_models dir: {}", e))?;

        let db_path = app_data_dir.join("rag.db");
        db::init_db(&db_path)?;

        let http_client = reqwest::Client::builder()
            .user_agent("Foliet-RAG/1.0")
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        Ok(Self {
            db_path,
            models_dir,
            http_client,
            loaded_model: Mutex::new(None),
        })
    }
}
