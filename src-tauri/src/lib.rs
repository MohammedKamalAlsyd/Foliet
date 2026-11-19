mod pdf_exporter;
mod pdf_models;
mod pdf_reader;
mod rag;
mod secrets;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use pdf_models::AnnotationDto;
use tauri::Manager;
use tauri::http::{Response, StatusCode, header};
use tauri_plugin_prevent_default::Flags;

enum CachedPdfData {
    File(File),
    Memory(Arc<Vec<u8>>),
}

struct CachedPdf {
    path: PathBuf,
    total: u64,
    data: CachedPdfData,
}

static FILE_POOL: OnceLock<Mutex<Vec<CachedPdf>>> = OnceLock::new();

fn same_path(a: &Path, b: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(target_os = "windows"))]
    {
        a == b
    }
}

fn take_cached_pdf(path: &Path) -> Result<(CachedPdfData, u64), StatusCode> {
    let pool = FILE_POOL.get_or_init(|| Mutex::new(Vec::with_capacity(8)));
    if let Ok(mut guard) = pool.lock() {
        if let Some(pos) = guard.iter().position(|c| same_path(&c.path, path)) {
            if let CachedPdfData::Memory(ref bytes) = guard[pos].data {
                return Ok((CachedPdfData::Memory(Arc::clone(bytes)), guard[pos].total));
            }
            let entry = guard.swap_remove(pos);
            return Ok((entry.data, entry.total));
        }
    }

    let file = File::open(path).map_err(|_| StatusCode::NOT_FOUND)?;
    let total = file
        .metadata()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();

    if let Some(clean_bytes) = pdf_exporter::strip_visual_annotations(path) {
        let arc = Arc::new(clean_bytes);
        let clean_total = arc.len() as u64;
        if let Ok(mut guard) = pool.lock() {
            if !guard.iter().any(|c| same_path(&c.path, path)) {
                if guard.len() >= 8 {
                    guard.remove(0);
                }
                guard.push(CachedPdf {
                    path: path.to_path_buf(),
                    total: clean_total,
                    data: CachedPdfData::Memory(Arc::clone(&arc)),
                });
            }
        }
        return Ok((CachedPdfData::Memory(arc), clean_total));
    }

    Ok((CachedPdfData::File(file), total))
}

fn return_cached_file(path: PathBuf, total: u64, data: CachedPdfData) {
    let CachedPdfData::File(file) = data else {
        return;
    };
    if let Some(pool) = FILE_POOL.get() {
        if let Ok(mut guard) = pool.lock() {
            if guard.iter().any(|c| same_path(&c.path, &path)) {
                return;
            }
            if guard.len() >= 8 {
                guard.remove(0);
            }
            guard.push(CachedPdf {
                path,
                total,
                data: CachedPdfData::File(file),
            });
        }
    }
}

fn evict_cached_file(path: &Path) {
    if let Some(pool) = FILE_POOL.get() {
        if let Ok(mut guard) = pool.lock() {
            guard.retain(|c| !same_path(&c.path, path));
        }
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn uri_to_local_path(uri_path: &str) -> PathBuf {
    let decoded = percent_decode(uri_path);
    #[cfg(target_os = "windows")]
    let clean = {
        let trimmed = decoded.trim_start_matches('/');
        if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
            trimmed.to_string()
        } else {
            decoded
        }
    };
    #[cfg(not(target_os = "windows"))]
    let clean = decoded;
    PathBuf::from(clean)
}

fn parse_range_header(range_val: &str, total: u64) -> Option<(u64, u64)> {
    let spec = range_val.strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    let start: u64 = if start_s.is_empty() {
        let suffix: u64 = end_s.parse().ok()?;
        total.saturating_sub(suffix)
    } else {
        start_s.parse().ok()?
    };
    let end: u64 = if end_s.is_empty() || start_s.is_empty() {
        total.saturating_sub(1)
    } else {
        end_s.parse::<u64>().ok()?.min(total.saturating_sub(1))
    };
    (start <= end && start < total).then_some((start, end))
}

fn build_pdf_response(method: &str, uri_path: &str, range_hdr: Option<&str>) -> Response<Vec<u8>> {
    if method == "OPTIONS" {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
            .header(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "Accept-Ranges, Content-Range, Content-Length",
            )
            .body(Vec::new())
            .unwrap_or_default();
    }

    let path = uri_to_local_path(uri_path);
    let is_pdf = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));

    if !is_pdf {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(Vec::new())
            .unwrap_or_default();
    }

    let (mut data, total) = match take_cached_pdf(&path) {
        Ok(res) => res,
        Err(status) => {
            return Response::builder()
                .status(status)
                .body(Vec::new())
                .unwrap_or_default();
        }
    };

    if method == "HEAD" {
        return_cached_file(path, total, data);
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/pdf")
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, total.to_string())
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(
                header::ACCESS_CONTROL_EXPOSE_HEADERS,
                "Accept-Ranges, Content-Range, Content-Length",
            )
            .body(Vec::new())
            .unwrap_or_default();
    }

    if let Some(range_str) = range_hdr {
        if let Some((start, end)) = parse_range_header(range_str, total) {
            let len = (end - start + 1) as usize;
            let buf_opt = match &mut data {
                CachedPdfData::Memory(arc) => Some(arc[start as usize..=end as usize].to_vec()),
                CachedPdfData::File(file) => {
                    let mut buf = vec![0u8; len];
                    (file.seek(SeekFrom::Start(start)).is_ok() && file.read_exact(&mut buf).is_ok())
                        .then_some(buf)
                }
            };

            if let Some(buf) = buf_opt {
                return_cached_file(path, total, data);
                return Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_TYPE, "application/pdf")
                    .header(header::ACCEPT_RANGES, "bytes")
                    .header(
                        header::CONTENT_RANGE,
                        format!("bytes {}-{}/{}", start, end, total),
                    )
                    .header(header::CONTENT_LENGTH, len.to_string())
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .header(
                        header::ACCESS_CONTROL_EXPOSE_HEADERS,
                        "Accept-Ranges, Content-Range, Content-Length",
                    )
                    .body(buf)
                    .unwrap_or_default();
            }
        }
        return_cached_file(path, total, data);
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{}", total))
            .body(Vec::new())
            .unwrap_or_default();
    }

    let buf = match &mut data {
        CachedPdfData::Memory(arc) => arc.as_ref().clone(),
        CachedPdfData::File(file) => {
            let mut buf = Vec::with_capacity(total as usize);
            let _ = file.seek(SeekFrom::Start(0));
            let _ = file.read_to_end(&mut buf);
            buf
        }
    };
    return_cached_file(path, total, data);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, total.to_string())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Accept-Ranges, Content-Range, Content-Length",
        )
        .body(buf)
        .unwrap_or_default()
}

#[tauri::command]
async fn export_pdf(
    source_path: String,
    target_path: String,
    annotations: Vec<AnnotationDto>,
) -> Result<(), String> {
    if source_path.trim().is_empty() || target_path.trim().is_empty() {
        return Err("Source and target paths cannot be empty.".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&source_path);
        let dst = PathBuf::from(&target_path);

        let output = pdf_exporter::burn_annotations_with_lopdf(&src, &annotations)?;

        evict_cached_file(&src);
        evict_cached_file(&dst);

        std::fs::write(&dst, output)
            .map_err(|e| format!("Failed to write '{}': {}", target_path, e))
    })
    .await
    .map_err(|e| format!("Export thread panicked: {:?}", e))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::FIND) // disables Ctrl+F / Cmd+F / F3 / Ctrl+G only
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app_data_dir: {}", e))?;
            let secrets_state =
                secrets::SecretsState::init(app_data_dir.clone(), &app.config().identifier);
            app.manage(secrets_state);
            let rag_state = rag::RagState::init(app_data_dir)?;
            app.manage(rag_state);
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("foliet-pdf", |_ctx, request, responder| {
            let method = request.method().to_string();
            let uri_path = request.uri().path().to_string();
            let range_hdr = request
                .headers()
                .get(header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_string);

            tauri::async_runtime::spawn_blocking(move || {
                let res = build_pdf_response(&method, &uri_path, range_hdr.as_deref());
                responder.respond(res);
            });
        })
        .invoke_handler(tauri::generate_handler![
            export_pdf,
            pdf_reader::open_pdf_document,
            pdf_reader::extract_pdf_annotations,
            rag::commands::rag_get_model_status,
            rag::commands::rag_download_model,
            rag::commands::rag_delete_model,
            rag::commands::rag_list_downloaded_models,
            rag::commands::rag_index_document,
            rag::commands::rag_remove_document_index,
            rag::commands::rag_get_catalog,
            rag::commands::rag_get_document_chunks,
            rag::commands::rag_search,
            secrets::load_api_secrets,
            secrets::save_api_secret,
            secrets::delete_api_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Foliet application");
}
