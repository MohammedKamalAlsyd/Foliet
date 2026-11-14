mod pdf_models;
mod pdf_reader;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

use pdf_models::AnnotationDto;
use tauri::http::{Response, StatusCode, header};

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

    let Ok(mut file) = File::open(&path) else {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap_or_default();
    };
    let Ok(meta) = file.metadata() else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Vec::new())
            .unwrap_or_default();
    };
    let total = meta.len();

    if let Some(range_str) = range_hdr {
        if let Some((start, end)) = parse_range_header(range_str, total) {
            let len = (end - start + 1) as usize;
            let mut buf = vec![0u8; len];
            if file.seek(SeekFrom::Start(start)).is_ok() && file.read_exact(&mut buf).is_ok() {
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
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{}", total))
            .body(Vec::new())
            .unwrap_or_default();
    }

    let mut buf = Vec::with_capacity(total as usize);
    let _ = file.read_to_end(&mut buf);
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
    _pdf_bytes: Vec<u8>,
    _annotations: Vec<AnnotationDto>,
) -> Result<Vec<u8>, String> {
    Err("PDF exporter has not been ported yet.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Foliet application");
}
