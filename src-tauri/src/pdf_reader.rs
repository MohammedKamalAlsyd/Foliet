use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use lopdf::{Dictionary, Document, Object};
use sha2::{Digest, Sha256};

use crate::pdf_exporter::geometry::{PageGeometry, pdf_point_to_normalized};
use crate::pdf_models::{AnnotationDto, BoundingBox, PdfOpenResult, Point};

const HEAD_SAMPLE_BYTES: usize = 65_536;
const TAIL_SAMPLE_BYTES: u64 = 16_384;

fn extract_tail_trailer_id(tail: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(tail);
    let id_pos = text.rfind("/ID")?;
    let after = &text[id_pos + 3..];
    let open = after.find('<')?;
    let close = after[open + 1..].find('>')?;
    let hex = after[open + 1..open + 1 + close].trim();
    if !hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(format!("doc-{}", hex.to_ascii_lowercase()))
    } else {
        None
    }
}

pub fn compute_fast_doc_id_from_path(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|e| format!("Failed to open '{}': {}", path.display(), e))?;
    let file_size = file
        .metadata()
        .map_err(|e| format!("Failed to read metadata for '{}': {}", path.display(), e))?
        .len();
    if file_size == 0 {
        return Err(format!("PDF file '{}' is empty (0 bytes).", path.display()));
    }
    compute_fast_doc_id(&mut file, file_size)
}

fn compute_fast_doc_id(file: &mut File, file_size: u64) -> Result<String, String> {
    let tail_len = file_size.min(TAIL_SAMPLE_BYTES);
    if tail_len > 0 {
        file.seek(SeekFrom::End(-(tail_len as i64)))
            .map_err(|e| format!("Failed seeking PDF tail: {}", e))?;
        let mut tail = vec![0u8; tail_len as usize];
        file.read_exact(&mut tail)
            .map_err(|e| format!("Failed reading PDF tail: {}", e))?;
        if let Some(id) = extract_tail_trailer_id(&tail) {
            return Ok(id);
        }
    }

    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed seeking PDF head: {}", e))?;
    let head_len = (file_size as usize).min(HEAD_SAMPLE_BYTES);
    let mut head = vec![0u8; head_len];
    file.read_exact(&mut head)
        .map_err(|e| format!("Failed reading PDF head: {}", e))?;

    let hash = Sha256::digest(&head);
    let hex_str: String = hash.iter().take(16).map(|b| format!("{:02x}", b)).collect();
    Ok(format!("doc-{}", hex_str))
}

pub fn read_pdf_fast_meta(file_path: &str) -> Result<PdfOpenResult, String> {
    let mut file =
        File::open(file_path).map_err(|e| format!("Failed to open '{}': {}", file_path, e))?;
    let file_size = file
        .metadata()
        .map_err(|e| format!("Failed to read metadata for '{}': {}", file_path, e))?
        .len();

    if file_size == 0 {
        return Err(format!("PDF file '{}' is empty (0 bytes).", file_path));
    }

    let doc_id = compute_fast_doc_id(&mut file, file_size)?;
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.pdf")
        .to_string();

    Ok(PdfOpenResult {
        doc_id,
        file_name,
        file_path: file_path.to_string(),
        file_size,
        num_pages: 0,
        extracted_annotations: None,
    })
}

fn parse_color(dict: &Dictionary) -> String {
    if let Ok(Object::Array(arr)) = dict.get(b"C") {
        let rgb: Vec<f32> = arr.iter().filter_map(|i| i.as_float().ok()).collect();
        if rgb.len() >= 3 {
            let r = (rgb[0].clamp(0.0, 1.0) * 255.0).round() as u8;
            let g = (rgb[1].clamp(0.0, 1.0) * 255.0).round() as u8;
            let b = (rgb[2].clamp(0.0, 1.0) * 255.0).round() as u8;
            return format!("#{:02X}{:02X}{:02X}", r, g, b);
        }
    }
    "#FACC15".to_string()
}

fn parse_id(dict: &Dictionary, page_num: usize, idx: usize) -> String {
    if let Ok(Object::String(bytes, _)) = dict.get(b"NM") {
        let s = String::from_utf8_lossy(bytes);
        let trimmed = s.trim();
        if let Some(stripped) = trimmed
            .strip_prefix("foliet-")
            .or_else(|| trimmed.strip_prefix("synapse-"))
        {
            return stripped.to_string();
        }
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    format!("annot-{}-{}", page_num, idx)
}

fn parse_contents(dict: &Dictionary) -> Option<String> {
    match dict.get(b"Contents") {
        Ok(Object::String(bytes, _)) => {
            let s = String::from_utf8_lossy(bytes).trim().to_string();
            (!s.is_empty()).then_some(s)
        }
        _ => None,
    }
}

fn parse_annotation(
    annot_dict: &Dictionary,
    page_number: usize,
    geometry: PageGeometry,
    idx: usize,
) -> Option<AnnotationDto> {
    let subtype = annot_dict.get(b"Subtype").and_then(|o| o.as_name()).ok()?;
    let tool_type = match subtype {
        b"Highlight" => "highlight",
        b"Underline" | b"Squiggly" => "underline",
        b"StrikeOut" => "strikethrough",
        b"Ink" => "freehand_write",
        b"Text" => "popup_note",
        _ => return None,
    };

    let underline_style = match subtype {
        b"Squiggly" => Some("squiggle".to_string()),
        b"Underline" => Some("solid".to_string()),
        _ => None,
    };

    let mut rect_segments = Vec::new();
    if matches!(
        subtype,
        b"Highlight" | b"Underline" | b"Squiggly" | b"StrikeOut"
    ) {
        if let Ok(Object::Array(qp)) = annot_dict.get(b"QuadPoints") {
            let coords: Vec<f32> = qp.iter().filter_map(|v| v.as_float().ok()).collect();
            for c in coords.chunks_exact(8) {
                let min_x = c[0].min(c[2]).min(c[4]).min(c[6]);
                let max_x = c[0].max(c[2]).max(c[4]).max(c[6]);
                let min_y = c[1].min(c[3]).min(c[5]).min(c[7]);
                let max_y = c[1].max(c[3]).max(c[5]).max(c[7]);
                if let (Some((x1, y1)), Some((x2, y2))) = (
                    pdf_point_to_normalized(min_x, max_y, geometry),
                    pdf_point_to_normalized(max_x, min_y, geometry),
                ) {
                    rect_segments.push(BoundingBox {
                        x: x1.min(x2),
                        y: y1.min(y2),
                        width: (x2 - x1).abs(),
                        height: (y2 - y1).abs(),
                    });
                }
            }
        }
        if rect_segments.is_empty() {
            if let Ok(Object::Array(r)) = annot_dict.get(b"Rect") {
                let coords: Vec<f32> = r.iter().filter_map(|v| v.as_float().ok()).collect();
                if coords.len() == 4 {
                    if let (Some((x1, y1)), Some((x2, y2))) = (
                        pdf_point_to_normalized(coords[0], coords[3], geometry),
                        pdf_point_to_normalized(coords[2], coords[1], geometry),
                    ) {
                        rect_segments.push(BoundingBox {
                            x: x1.min(x2),
                            y: y1.min(y2),
                            width: (x2 - x1).abs(),
                            height: (y2 - y1).abs(),
                        });
                    }
                }
            }
        }
    }

    let mut points = Vec::new();
    let mut stroke_width = None;
    if subtype == b"Ink" {
        if let Ok(Object::Array(ink_lists)) = annot_dict.get(b"InkList") {
            for stroke in ink_lists {
                if let Ok(arr) = stroke.as_array() {
                    let coords: Vec<f32> = arr.iter().filter_map(|v| v.as_float().ok()).collect();
                    for pt in coords.chunks_exact(2) {
                        if let Some((nx, ny)) = pdf_point_to_normalized(pt[0], pt[1], geometry) {
                            points.push(Point { x: nx, y: ny });
                        }
                    }
                }
            }
        }
        if let Ok(Object::Dictionary(bs)) = annot_dict.get(b"BS") {
            stroke_width = bs.get(b"W").and_then(|v| v.as_float()).ok();
        }
    }

    let (mut note_x, mut note_y) = (None, None);
    if subtype == b"Text" {
        if let Ok(Object::Array(r)) = annot_dict.get(b"Rect") {
            let coords: Vec<f32> = r.iter().filter_map(|v| v.as_float().ok()).collect();
            if coords.len() == 4 {
                if let Some((nx, ny)) = pdf_point_to_normalized(
                    (coords[0] + coords[2]) / 2.0,
                    (coords[1] + coords[3]) / 2.0,
                    geometry,
                ) {
                    note_x = Some(nx);
                    note_y = Some(ny);
                }
            }
        }
    }

    Some(AnnotationDto {
        id: parse_id(annot_dict, page_number, idx),
        page_number,
        tool_type: tool_type.to_string(),
        color: parse_color(annot_dict),
        text: Some(String::new()),
        rect_segments,
        points,
        stroke_width,
        comment: parse_contents(annot_dict),
        underline_style,
        x: note_x,
        y: note_y,
    })
}

#[tauri::command]
pub async fn open_pdf_document(file_path: String) -> Result<PdfOpenResult, String> {
    if file_path.trim().is_empty() {
        return Err("File path cannot be empty.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || read_pdf_fast_meta(&file_path))
        .await
        .map_err(|e| format!("Worker panicked: {:?}", e))?
}

#[tauri::command]
pub async fn extract_pdf_annotations(file_path: String) -> Result<Vec<AnnotationDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let doc = Document::load(&file_path)
            .map_err(|e| format!("Failed to parse annotations: {:?}", e))?;
        let mut result = Vec::new();
        let mut idx = 0;

        for (page_num, page_id) in doc.get_pages() {
            let geometry = PageGeometry::from_page(&doc, page_id);
            let Ok(page_dict) = doc.get_object(page_id).and_then(|o| o.as_dict()) else {
                continue;
            };
            let Ok(Object::Array(annots)) = page_dict.get(b"Annots") else {
                continue;
            };
            for item in annots {
                let Ok(annot_ref) = item.as_reference() else {
                    continue;
                };
                let Ok(annot_dict) = doc.get_object(annot_ref).and_then(|o| o.as_dict()) else {
                    continue;
                };
                if let Some(dto) = parse_annotation(annot_dict, page_num as usize, geometry, idx) {
                    result.push(dto);
                    idx += 1;
                }
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| format!("Worker panicked: {:?}", e))?
}
