pub mod annotations;
pub mod geometry;

use std::path::Path;

use lopdf::{Document as LopdfDocument, Object as LopdfObject, StringFormat};

use crate::pdf_models::AnnotationDto;
use crate::pdf_reader::compute_fast_doc_id_from_path;
use annotations::{create_highlight, create_ink, create_note, create_strikeout, create_underline};
use geometry::PageGeometry;

fn is_visual_annotation(doc: &LopdfDocument, obj: &LopdfObject) -> bool {
    let dict = match obj {
        LopdfObject::Reference(id) => match doc.get_object(*id).and_then(|o| o.as_dict()) {
            Ok(d) => d,
            Err(_) => return false,
        },
        LopdfObject::Dictionary(d) => d,
        _ => return false,
    };

    matches!(
        dict.get(b"Subtype").and_then(|o| o.as_name()),
        Ok(b"Highlight" | b"Underline" | b"Squiggly" | b"StrikeOut" | b"Ink" | b"Text" | b"Popup")
    )
}

fn hex_to_raw_bytes(hex: &str) -> Vec<u8> {
    let bytes: Vec<u8> = hex
        .as_bytes()
        .chunks_exact(2)
        .filter_map(|c| {
            std::str::from_utf8(c)
                .ok()
                .and_then(|s| u8::from_str_radix(s, 16).ok())
        })
        .collect();

    if bytes.is_empty() {
        hex.as_bytes().to_vec()
    } else {
        bytes
    }
}

/// Burns annotations into `source_path` using ISO 32000-1 Form XObjects and returns serialized PDF bytes.
pub fn burn_annotations_with_lopdf(
    source_path: &Path,
    annotations: &[AnnotationDto],
) -> Result<Vec<u8>, String> {
    let mut doc = LopdfDocument::load(source_path)
        .map_err(|e| format!("Failed to parse PDF '{}': {:?}", source_path.display(), e))?;

    // Lock in permanent trailer /ID so saving never causes Foliet's doc_id to drift
    if doc.trailer.get(b"ID").is_err() {
        let permanent_id = compute_fast_doc_id_from_path(source_path)?;
        let id_raw = permanent_id.strip_prefix("doc-").unwrap_or(&permanent_id);
        let raw_bytes = hex_to_raw_bytes(id_raw);
        doc.trailer.set(
            "ID",
            LopdfObject::Array(vec![
                LopdfObject::String(raw_bytes.clone(), StringFormat::Hexadecimal),
                LopdfObject::String(raw_bytes, StringFormat::Hexadecimal),
            ]),
        );
    }

    let pages: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();

    for (page_num, page_id) in pages {
        let geometry = PageGeometry::from_page(&doc, page_id);

        let mut kept_annots: Vec<LopdfObject> = {
            let Ok(page_dict) = doc.get_object(page_id).and_then(|o| o.as_dict()) else {
                continue;
            };
            match page_dict.get(b"Annots") {
                Ok(LopdfObject::Array(arr)) => arr
                    .iter()
                    .filter(|item| !is_visual_annotation(&doc, item))
                    .cloned()
                    .collect(),
                _ => Vec::new(),
            }
        };

        for annot in annotations
            .iter()
            .filter(|a| a.page_number == page_num as usize)
        {
            let annot_dict = match annot.tool_type.as_str() {
                "highlight" => create_highlight(&mut doc, annot, geometry),
                "underline" => create_underline(&mut doc, annot, geometry),
                "strikethrough" => create_strikeout(&mut doc, annot, geometry),
                "freehand_write" => create_ink(&mut doc, annot, geometry),
                "popup_note" => create_note(&mut doc, annot, geometry),
                _ => None,
            };

            if let Some(dict) = annot_dict {
                let id = doc.add_object(LopdfObject::Dictionary(dict));
                kept_annots.push(LopdfObject::Reference(id));
            }
        }

        if let Ok(page_dict) = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()) {
            if !kept_annots.is_empty() {
                page_dict.set("Annots", LopdfObject::Array(kept_annots));
            } else {
                page_dict.remove(b"Annots");
            }
        }
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| format!("Failed to serialize PDF: {:?}", e))?;

    Ok(output)
}

pub fn strip_visual_annotations(path: &Path) -> Option<Vec<u8>> {
    let mut doc = LopdfDocument::load(path).ok()?;
    let pages: Vec<lopdf::ObjectId> = doc.get_pages().into_values().collect();
    let mut modified = false;

    for page_id in pages {
        let filtered_annots: Option<Vec<LopdfObject>> = {
            let Ok(page_dict) = doc.get_object(page_id).and_then(|o| o.as_dict()) else {
                continue;
            };
            let Ok(LopdfObject::Array(arr)) = page_dict.get(b"Annots") else {
                continue;
            };
            let kept: Vec<LopdfObject> = arr
                .iter()
                .filter(|item| !is_visual_annotation(&doc, item))
                .cloned()
                .collect();
            (kept.len() != arr.len()).then_some(kept)
        };

        if let Some(kept) = filtered_annots {
            modified = true;
            if let Ok(page_dict) = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()) {
                if kept.is_empty() {
                    page_dict.remove(b"Annots");
                } else {
                    page_dict.set("Annots", LopdfObject::Array(kept));
                }
            }
        }
    }

    if !modified {
        return None;
    }

    let mut output = Vec::new();
    doc.save_to(&mut output).ok()?;
    Some(output)
}
