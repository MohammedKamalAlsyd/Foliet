use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use lopdf::{Document, Object, ObjectId, content::Content};

use super::models::{RagHyperparameters, RectSegment};

#[derive(Debug, Clone)]
pub struct ExtractedLine {
    pub text: String,
    pub rect: Option<RectSegment>,
}

#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub page_number: usize,
    pub lines: Vec<ExtractedLine>,
}

#[derive(Debug, Clone)]
pub struct PreparedChunk {
    pub chunk_id: String,
    pub page_number: usize,
    pub chunk_index: usize,
    pub text: String,
    pub rect_segments: Vec<RectSegment>,
}

#[derive(Debug, Clone, Copy)]
struct PdfBox {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(Debug, Clone)]
struct SpanBox {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    hint: String,
}

pub const SCANNED_PDF_ERROR: &str = "This PDF has no selectable text spans (likely a scanned image). OCR is required before indexing.";

fn is_page_in_ranges(page_num: usize, ranges: Option<&[[usize; 2]]>) -> bool {
    let Some(ranges) = ranges else {
        return true;
    };
    if ranges.is_empty() {
        return true;
    }
    ranges
        .iter()
        .any(|[start, end]| page_num >= *start.min(end) && page_num <= *start.max(end))
}

fn obj_to_f32(obj: &Object) -> Option<f32> {
    match obj {
        Object::Real(f) => Some(*f),
        Object::Integer(i) => Some(*i as f32),
        _ => None,
    }
}

fn resolve_array_box(doc: &Document, obj: &Object) -> Option<PdfBox> {
    let resolved = match obj {
        Object::Reference(id) => doc.get_object(*id).ok()?,
        other => other,
    };
    let Object::Array(arr) = resolved else {
        return None;
    };
    if arr.len() < 4 {
        return None;
    }
    let x1 = obj_to_f32(&arr[0])?;
    let y1 = obj_to_f32(&arr[1])?;
    let x2 = obj_to_f32(&arr[2])?;
    let y2 = obj_to_f32(&arr[3])?;
    let width = (x2 - x1).abs();
    let height = (y2 - y1).abs();
    if width <= 1.0 || height <= 1.0 {
        return None;
    }
    Some(PdfBox {
        x: x1.min(x2),
        y: y1.min(y2),
        width,
        height,
    })
}

fn get_inherited_box(doc: &Document, start_id: ObjectId, key: &[u8]) -> Option<PdfBox> {
    let mut current = Some(start_id);
    let mut depth = 0usize;
    while let Some(obj_id) = current {
        if depth > 16 {
            break;
        }
        depth += 1;
        let Ok(dict) = doc.get_dictionary(obj_id) else {
            break;
        };
        if let Ok(val) = dict.get(key) {
            if let Some(b) = resolve_array_box(doc, val) {
                return Some(b);
            }
        }
        current = dict.get(b"Parent").ok().and_then(|p| p.as_reference().ok());
    }
    None
}

fn get_page_crop_box(doc: &Document, page_id: ObjectId) -> PdfBox {
    get_inherited_box(doc, page_id, b"CropBox")
        .or_else(|| get_inherited_box(doc, page_id, b"MediaBox"))
        .unwrap_or(PdfBox {
            x: 0.0,
            y: 0.0,
            width: 612.0,
            height: 792.0,
        })
}

#[inline]
fn mul_matrix(m1: [f32; 6], m2: [f32; 6]) -> [f32; 6] {
    [
        m1[0] * m2[0] + m1[1] * m2[2],
        m1[0] * m2[1] + m1[1] * m2[3],
        m1[2] * m2[0] + m1[3] * m2[2],
        m1[2] * m2[1] + m1[3] * m2[3],
        m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
        m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
    ]
}

#[inline]
fn apply_matrix(m: [f32; 6], x: f32, y: f32) -> (f32, f32) {
    (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
}

fn decode_pdf_string_fallback(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let utf16: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&utf16);
    }

    bytes
        .iter()
        .map(|&b| {
            if (0x20..=0x7E).contains(&b) || b == b'\n' || b == b'\r' || b == b'\t' {
                b as char
            } else if b >= 0xA0 {
                b as char
            } else {
                ' '
            }
        })
        .collect()
}

fn estimate_glyph_count(bytes: &[u8]) -> usize {
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        (bytes.len() - 2) / 2
    } else {
        bytes.len().max(1)
    }
}

/// Extracts normalized line-level bounding boxes from a page's PDF content stream,
/// accounting for CTM, Text Matrix, and CropBox coordinate origin inversion.
fn extract_page_line_boxes(doc: &Document, page_id: ObjectId) -> Vec<(String, RectSegment)> {
    let raw_content = doc.get_page_content(page_id);
    if raw_content.is_empty() {
        return Vec::new();
    }
    let Ok(content) = Content::decode(&raw_content) else {
        return Vec::new();
    };

    let cropbox = get_page_crop_box(doc, page_id);
    let mut ctm: [f32; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut ctm_stack: Vec<[f32; 6]> = Vec::new();

    let mut tm: [f32; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut tlm: [f32; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut font_size: f32 = 10.0;
    let mut leading: f32 = 12.0;
    let mut h_scale: f32 = 1.0;

    let mut spans: Vec<SpanBox> = Vec::new();

    for op in content.operations {
        match op.operator.as_str() {
            "q" => {
                ctm_stack.push(ctm);
            }
            "Q" => {
                if let Some(prev) = ctm_stack.pop() {
                    ctm = prev;
                }
            }
            "cm" => {
                if op.operands.len() >= 6 {
                    if let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
                        obj_to_f32(&op.operands[0]),
                        obj_to_f32(&op.operands[1]),
                        obj_to_f32(&op.operands[2]),
                        obj_to_f32(&op.operands[3]),
                        obj_to_f32(&op.operands[4]),
                        obj_to_f32(&op.operands[5]),
                    ) {
                        ctm = mul_matrix([a, b, c, d, e, f], ctm);
                    }
                }
            }
            "BT" => {
                tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
                tlm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
            }
            "Tf" => {
                if op.operands.len() >= 2 {
                    if let Some(sz) = obj_to_f32(&op.operands[1]) {
                        if sz.abs() > 0.1 {
                            font_size = sz.abs();
                        }
                    }
                }
            }
            "TL" => {
                if let Some(l) = op.operands.first().and_then(obj_to_f32) {
                    leading = l;
                }
            }
            "Tz" => {
                if let Some(tz) = op.operands.first().and_then(obj_to_f32) {
                    if tz.abs() > 1.0 {
                        h_scale = tz / 100.0;
                    }
                }
            }
            "Tm" => {
                if op.operands.len() >= 6 {
                    if let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
                        obj_to_f32(&op.operands[0]),
                        obj_to_f32(&op.operands[1]),
                        obj_to_f32(&op.operands[2]),
                        obj_to_f32(&op.operands[3]),
                        obj_to_f32(&op.operands[4]),
                        obj_to_f32(&op.operands[5]),
                    ) {
                        tm = [a, b, c, d, e, f];
                        tlm = tm;
                    }
                }
            }
            "Td" | "TD" => {
                if op.operands.len() >= 2 {
                    if let (Some(tx), Some(ty)) =
                        (obj_to_f32(&op.operands[0]), obj_to_f32(&op.operands[1]))
                    {
                        if op.operator == "TD" {
                            leading = -ty;
                        }
                        tlm = mul_matrix([1.0, 0.0, 0.0, 1.0, tx, ty], tlm);
                        tm = tlm;
                    }
                }
            }
            "T*" => {
                tlm = mul_matrix([1.0, 0.0, 0.0, 1.0, 0.0, -leading], tlm);
                tm = tlm;
            }
            "Tj" | "'" | "\"" | "TJ" => {
                if op.operator == "'" || op.operator == "\"" {
                    tlm = mul_matrix([1.0, 0.0, 0.0, 1.0, 0.0, -leading], tlm);
                    tm = tlm;
                }

                let mut text_advance = 0.0f32;
                let mut hint = String::new();

                if op.operator == "TJ" {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        for item in arr {
                            match item {
                                Object::String(bytes, _) => {
                                    let count = estimate_glyph_count(bytes) as f32;
                                    text_advance += count * 0.48 * font_size * h_scale;
                                    hint.push_str(&decode_pdf_string_fallback(bytes));
                                }
                                Object::Integer(n) => {
                                    if *n < -120 {
                                        hint.push(' ');
                                    }
                                    text_advance -= (*n as f32 / 1000.0) * font_size * h_scale;
                                }
                                Object::Real(f) => {
                                    if *f < -120.0 {
                                        hint.push(' ');
                                    }
                                    text_advance -= (*f / 1000.0) * font_size * h_scale;
                                }
                                _ => {}
                            }
                        }
                    }
                } else if let Some(bytes) = op.operands.last().and_then(|o| o.as_str().ok()) {
                    let count = estimate_glyph_count(bytes) as f32;
                    text_advance = count * 0.48 * font_size * h_scale;
                    hint.push_str(&decode_pdf_string_fallback(bytes));
                }

                if text_advance > 0.2 {
                    let trm = mul_matrix(tm, ctm);
                    let (gx0, gy0) = apply_matrix(trm, 0.0, -0.2 * font_size);
                    let (gx1, gy1) = apply_matrix(trm, text_advance, 0.85 * font_size);

                    let glyph_x = gx0.min(gx1);
                    let glyph_y = gy0.min(gy1);
                    let glyph_width = (gx1 - gx0).abs().max(1.0);
                    let glyph_height = (gy1 - gy0).abs().max(font_size * 0.75);

                    let rel_x = ((glyph_x - cropbox.x) / cropbox.width).clamp(0.0, 1.0);
                    let rel_width = (glyph_width / cropbox.width).clamp(0.002, 1.0 - rel_x);
                    let rel_y = ((cropbox.y + cropbox.height - (glyph_y + glyph_height))
                        / cropbox.height)
                        .clamp(0.0, 1.0);
                    let rel_height = (glyph_height / cropbox.height).clamp(0.004, 1.0 - rel_y);

                    if rel_width > 0.002 && rel_height > 0.004 {
                        spans.push(SpanBox {
                            x: rel_x,
                            y: rel_y,
                            width: rel_width,
                            height: rel_height,
                            hint: normalize_inline_whitespace(&hint),
                        });
                    }

                    tm = mul_matrix([1.0, 0.0, 0.0, 1.0, text_advance, 0.0], tm);
                }
            }
            _ => {}
        }
    }

    // Group adjacent spans on the same visual line WITHOUT bridging column gaps
    let mut lines: Vec<(String, RectSegment)> = Vec::new();
    for sp in spans {
        let can_merge = lines.last_mut().and_then(|(prev_hint, prev_r)| {
            let overlap_y = (prev_r.y + prev_r.height).min(sp.y + sp.height) - prev_r.y.max(sp.y);
            let min_h = prev_r.height.min(sp.height);
            let same_line = min_h > 0.0 && overlap_y / min_h > 0.45;
            let gap_x = (sp.x - (prev_r.x + prev_r.width))
                .max(prev_r.x - (sp.x + sp.width))
                .max(0.0);
            // Keep columns separate: never merge spans separated by > 3.5% of page width
            if same_line && gap_x <= 0.035 {
                Some((prev_hint, prev_r))
            } else {
                None
            }
        });

        if let Some((prev_hint, prev_r)) = can_merge {
            let min_x = prev_r.x.min(sp.x);
            let min_y = prev_r.y.min(sp.y);
            let max_x = (prev_r.x + prev_r.width).max(sp.x + sp.width);
            let max_y = (prev_r.y + prev_r.height).max(sp.y + sp.height);
            prev_r.x = min_x;
            prev_r.y = min_y;
            prev_r.width = max_x - min_x;
            prev_r.height = max_y - min_y;
            if !sp.hint.is_empty() {
                if !prev_hint.is_empty() {
                    prev_hint.push(' ');
                }
                prev_hint.push_str(&sp.hint);
            }
        } else {
            lines.push((
                sp.hint,
                RectSegment {
                    x: sp.x,
                    y: sp.y,
                    width: sp.width,
                    height: sp.height,
                },
            ));
        }
    }

    lines
}

/// Lightweight pure-Rust fallback if `lopdf::Document::extract_text` fails on a page.
fn extract_page_content_fallback(doc: &Document, page_id: ObjectId) -> String {
    let raw_content = doc.get_page_content(page_id);
    if raw_content.is_empty() {
        return String::new();
    }
    let Ok(content) = Content::decode(&raw_content) else {
        return String::new();
    };

    let mut out = String::new();
    for op in content.operations {
        match op.operator.as_str() {
            "Tj" | "'" | "\"" => {
                for operand in &op.operands {
                    if let Ok(bytes) = operand.as_str() {
                        out.push_str(&decode_pdf_string_fallback(bytes));
                    }
                }
                if op.operator == "'" || op.operator == "\"" {
                    out.push('\n');
                }
            }
            "TJ" => {
                if let Some(Object::Array(arr)) = op.operands.first() {
                    for item in arr {
                        match item {
                            Object::String(bytes, _) => {
                                out.push_str(&decode_pdf_string_fallback(bytes));
                            }
                            Object::Integer(n) if *n < -120 => out.push(' '),
                            Object::Real(f) if *f < -120.0 => out.push(' '),
                            _ => {}
                        }
                    }
                }
            }
            "Td" | "TD" | "T*" | "BT" | "ET" => {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            _ => {}
        }
    }
    out
}

fn normalize_inline_whitespace(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut prev_space = false;
    for ch in input.chars() {
        if ch.is_control() && ch != '\n' {
            continue;
        }
        if ch == ' ' || ch == '\t' || ch == '\u{00A0}' {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out.trim().to_string()
}

fn merge_two_rects(a: Option<RectSegment>, b: Option<RectSegment>) -> Option<RectSegment> {
    match (a, b) {
        (Some(ra), Some(rb)) => {
            let overlap_y = (ra.y + ra.height).min(rb.y + rb.height) - ra.y.max(rb.y);
            let min_h = ra.height.min(rb.height);
            if min_h > 0.0 && overlap_y / min_h > 0.45 {
                let min_x = ra.x.min(rb.x);
                let min_y = ra.y.min(rb.y);
                let max_x = (ra.x + ra.width).max(rb.x + rb.width);
                let max_y = (ra.y + ra.height).max(rb.y + rb.height);
                Some(RectSegment {
                    x: min_x,
                    y: min_y,
                    width: max_x - min_x,
                    height: max_y - min_y,
                })
            } else {
                Some(ra)
            }
        }
        (Some(ra), None) => Some(ra),
        (None, Some(rb)) => Some(rb),
        (None, None) => None,
    }
}

fn align_lines_with_boxes(
    raw_text: &str,
    line_boxes: &[(String, RectSegment)],
) -> Vec<ExtractedLine> {
    let raw_lines: Vec<String> = raw_text
        .lines()
        .map(normalize_inline_whitespace)
        .filter(|l| !l.is_empty())
        .collect();

    if raw_lines.is_empty() || line_boxes.is_empty() {
        return raw_lines
            .into_iter()
            .map(|text| ExtractedLine { text, rect: None })
            .collect();
    }

    let mut aligned = Vec::with_capacity(raw_lines.len());
    let mut box_cursor = 0usize;

    for (idx, line) in raw_lines.iter().enumerate() {
        let mut matched_rect: Option<RectSegment> = None;

        // First try matching decoded hint prefixes in a forward window
        let line_key: String = line
            .chars()
            .filter(|c| c.is_alphanumeric())
            .take(12)
            .collect::<String>()
            .to_lowercase();

        if line_key.len() >= 4 {
            let search_end = (box_cursor + 6).min(line_boxes.len());
            for j in box_cursor..search_end {
                let box_key: String = line_boxes[j]
                    .0
                    .chars()
                    .filter(|c| c.is_alphanumeric())
                    .take(12)
                    .collect::<String>()
                    .to_lowercase();
                if box_key.len() >= 4
                    && (box_key.starts_with(&line_key[..4]) || line_key.starts_with(&box_key[..4]))
                {
                    matched_rect = Some(line_boxes[j].1.clone());
                    box_cursor = j + 1;
                    break;
                }
            }
        }

        // Proportional fallback for CID / ToUnicode-only fonts where fallback decode yields empty hints
        if matched_rect.is_none() {
            let approx_idx = if raw_lines.len() > 1 {
                ((idx as f32 / (raw_lines.len() - 1) as f32) * (line_boxes.len() - 1) as f32)
                    .round() as usize
            } else {
                0
            };
            let chosen = box_cursor.max(approx_idx).min(line_boxes.len() - 1);
            matched_rect = Some(line_boxes[chosen].1.clone());
            box_cursor = (chosen + 1).min(line_boxes.len());
        }

        aligned.push(ExtractedLine {
            text: line.clone(),
            rect: matched_rect,
        });
    }

    aligned
}

/// Dehyphenates wrapped line breaks (`word-\nbreak` -> `wordbreak`) and cleans lines.
fn dehyphenate_and_split_lines(
    raw_text: &str,
    line_boxes: &[(String, RectSegment)],
) -> Vec<ExtractedLine> {
    let raw_lines = align_lines_with_boxes(raw_text, line_boxes);

    let mut merged: Vec<ExtractedLine> = Vec::with_capacity(raw_lines.len());
    for line in raw_lines {
        if let Some(prev) = merged.last_mut() {
            let prev_trimmed = prev.text.trim_end();
            let ends_with_hyphen = prev_trimmed.ends_with('-')
                && prev_trimmed.len() >= 2
                && prev_trimmed[..prev_trimmed.len() - 1]
                    .chars()
                    .last()
                    .is_some_and(|c| c.is_ascii_alphabetic());
            let starts_with_lower = line
                .text
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_lowercase());

            if ends_with_hyphen && starts_with_lower {
                prev.text.truncate(prev_trimmed.len() - 1);
                prev.text.push_str(&line.text);
                prev.rect = merge_two_rects(prev.rect.take(), line.rect);
                continue;
            }
        }
        merged.push(line);
    }

    merged
}

fn normalize_header_footer_key(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    for ch in line.trim().to_lowercase().chars() {
        if ch.is_ascii_digit() {
            out.push('#');
        } else if ch.is_alphanumeric() || ch == ' ' {
            out.push(ch);
        }
    }
    normalize_inline_whitespace(&out)
}

fn is_standalone_page_number(line: &str) -> bool {
    let lower = line.trim().to_lowercase();
    let stripped = lower.trim_matches(|c: char| {
        c == '-' || c == '—' || c == '|' || c == '[' || c == ']' || c.is_whitespace()
    });

    if stripped.is_empty() {
        return true;
    }
    if stripped.len() <= 5 && stripped.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if let Some(rest) = stripped.strip_prefix("page ") {
        let rest = rest.trim();
        if rest
            .chars()
            .all(|c| c.is_ascii_digit() || c == '/' || c == 'o' || c == 'f' || c == ' ')
        {
            return true;
        }
    }
    false
}

fn strip_running_headers_and_footers(pages: &mut [ExtractedPage]) {
    let page_count = pages.len();
    if page_count < 4 {
        for p in pages.iter_mut() {
            p.lines.retain(|l| !is_standalone_page_number(&l.text));
        }
        return;
    }

    let mut freq: HashMap<String, usize> = HashMap::new();
    for page in pages.iter() {
        let mut seen_on_page = BTreeSet::new();
        let n = page.lines.len();
        let candidate_indices: Vec<usize> = (0..n.min(2)).chain(n.saturating_sub(2)..n).collect();

        for idx in candidate_indices {
            let line = &page.lines[idx].text;
            if line.len() <= 120 {
                let key = normalize_header_footer_key(line);
                if !key.is_empty() && seen_on_page.insert(key.clone()) {
                    *freq.entry(key).or_insert(0) += 1;
                }
            }
        }
    }

    let min_repeats = (page_count * 35 / 100).max(3);

    for page in pages.iter_mut() {
        let n = page.lines.len();
        let mut keep = vec![true; n];

        for idx in (0..n.min(2)).chain(n.saturating_sub(2)..n) {
            let line = &page.lines[idx].text;
            if is_standalone_page_number(line) {
                keep[idx] = false;
                continue;
            }
            if line.len() <= 120 {
                let key = normalize_header_footer_key(line);
                if freq.get(&key).copied().unwrap_or(0) >= min_repeats {
                    keep[idx] = false;
                }
            }
        }

        let mut filtered = Vec::with_capacity(n);
        for (idx, line) in page.lines.drain(..).enumerate() {
            if keep[idx] && !is_standalone_page_number(&line.text) {
                filtered.push(line);
            }
        }
        page.lines = filtered;
    }
}

fn is_sparse_cover_or_meta_page(page_index: usize, lines: &[ExtractedLine]) -> bool {
    if page_index > 2 {
        return false;
    }
    let joined = lines
        .iter()
        .map(|l| l.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let words = joined.split_whitespace().count();
    let alnum = joined.chars().filter(|c| c.is_alphanumeric()).count();
    if alnum < 160 || words < 25 {
        return true;
    }
    let lower = joined.to_lowercase();
    let has_pub_meta = lower.contains("isbn")
        || lower.contains("copyright ©")
        || lower.contains("all rights reserved")
        || lower.contains("printed in");
    has_pub_meta && words < 95
}

fn is_toc_page(lines: &[ExtractedLine]) -> bool {
    if lines.is_empty() {
        return false;
    }
    let first_lines = lines
        .iter()
        .take(3)
        .map(|l| l.text.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    let has_toc_heading = first_lines.contains("table of contents")
        || lines
            .first()
            .is_some_and(|l| l.text.trim().eq_ignore_ascii_case("contents"));

    let mut toc_like_lines = 0usize;
    for line in lines {
        let trimmed = line.text.trim();
        let has_dots = trimmed.contains("....") || trimmed.contains("…");
        let ends_with_num = trimmed.split_whitespace().last().is_some_and(|tok| {
            !tok.is_empty() && tok.len() <= 5 && tok.chars().all(|c| c.is_ascii_digit())
        });
        if has_dots || (ends_with_num && trimmed.len() <= 95) {
            toc_like_lines += 1;
        }
    }

    let ratio = toc_like_lines as f32 / lines.len().max(1) as f32;
    (has_toc_heading && ratio >= 0.2) || ratio >= 0.40
}

fn is_references_heading(line: &str) -> bool {
    let trimmed = line.trim().to_lowercase();
    let stripped = trimmed
        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ' ')
        .trim();
    matches!(
        stripped,
        "references" | "bibliography" | "works cited" | "literature cited" | "reference list"
    )
}

fn is_appendix_heading(line: &str) -> bool {
    let trimmed = line.trim().to_lowercase();
    trimmed == "appendix" || trimmed.starts_with("appendix ")
}

fn is_back_index_page(page_index: usize, total_pages: usize, lines: &[ExtractedLine]) -> bool {
    if total_pages < 8 || page_index < (total_pages * 3) / 4 || lines.is_empty() {
        return false;
    }
    let starts_with_index = lines
        .first()
        .is_some_and(|l| l.text.trim().eq_ignore_ascii_case("index"));

    let mut locator_lines = 0usize;
    for line in lines {
        let t = line.text.trim();
        let has_comma_num =
            t.contains(',') && t.chars().rev().take(8).any(|c| c.is_ascii_digit()) && t.len() <= 90;
        if has_comma_num {
            locator_lines += 1;
        }
    }
    let ratio = locator_lines as f32 / lines.len().max(1) as f32;
    (starts_with_index && ratio >= 0.25) || ratio >= 0.48
}

/// Wraps overly long PDF lines (~120 chars) so line-based chunking stays uniform,
/// carrying forward each line's bounding rect.
fn wrap_long_lines(lines: &[ExtractedLine], max_line_chars: usize) -> Vec<ExtractedLine> {
    let mut wrapped = Vec::with_capacity(lines.len());
    for line in lines {
        if line.text.len() <= max_line_chars {
            wrapped.push(line.clone());
            continue;
        }
        let mut current = String::new();
        for word in line.text.split_whitespace() {
            if !current.is_empty() && current.len() + 1 + word.len() > max_line_chars {
                wrapped.push(ExtractedLine {
                    text: current,
                    rect: line.rect.clone(),
                });
                current = String::new();
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        if !current.is_empty() {
            wrapped.push(ExtractedLine {
                text: current,
                rect: line.rect.clone(),
            });
        }
    }
    wrapped
}

/// Merges only collinear/touching line segments (never merges separate lines or columns).
fn merge_line_rects(lines: &[ExtractedLine]) -> Vec<RectSegment> {
    let mut raw: Vec<RectSegment> = lines.iter().filter_map(|l| l.rect.clone()).collect();
    if raw.len() <= 1 {
        return raw;
    }

    let mut merged: Vec<RectSegment> = Vec::with_capacity(raw.len());
    for r in raw.drain(..) {
        let target = merged.iter_mut().find(|m| {
            let overlap_y = (m.y + m.height).min(r.y + r.height) - m.y.max(r.y);
            let min_h = m.height.min(r.height);
            let same_line = min_h > 0.0 && overlap_y / min_h > 0.5;
            let horizontal_touch = r.x <= m.x + m.width + 0.012 && m.x <= r.x + r.width + 0.012;
            same_line && horizontal_touch
        });
        if let Some(m) = target {
            let min_x = m.x.min(r.x);
            let min_y = m.y.min(r.y);
            let max_x = (m.x + m.width).max(r.x + r.width);
            let max_y = (m.y + m.height).max(r.y + r.height);
            m.x = min_x;
            m.y = min_y;
            m.width = max_x - min_x;
            m.height = max_y - min_y;
        } else {
            merged.push(r);
        }
    }
    merged
}

pub fn extract_and_chunk_pdf<F>(
    file_path: &Path,
    doc_id: &str,
    selected_page_ranges: Option<&[[usize; 2]]>,
    config: &RagHyperparameters,
    mut on_progress: F,
) -> Result<(Vec<PreparedChunk>, usize), String>
where
    F: FnMut(&str, usize, usize, usize, usize, u8),
{
    let doc = Document::load(file_path)
        .map_err(|e| format!("Failed to open PDF '{}': {}", file_path.display(), e))?;

    let all_pages = doc.get_pages();
    let target_pages: Vec<(u32, ObjectId)> = all_pages
        .into_iter()
        .filter(|(page_num, _)| is_page_in_ranges(*page_num as usize, selected_page_ranges))
        .collect();

    let total_pages = target_pages.len();
    if total_pages == 0 {
        return Err("No matching pages found in the selected page range.".to_string());
    }

    let mut extracted_pages: Vec<ExtractedPage> = Vec::with_capacity(total_pages);
    let mut total_raw_alnum: usize = 0;

    for (idx, (page_num, page_id)) in target_pages.iter().enumerate() {
        let current_page = idx + 1;
        let raw_text = match doc.extract_text(&[*page_num]) {
            Ok(t) if !t.trim().is_empty() => t,
            _ => extract_page_content_fallback(&doc, *page_id),
        };

        total_raw_alnum += raw_text.chars().filter(|c| c.is_alphanumeric()).count();
        let line_boxes = extract_page_line_boxes(&doc, *page_id);
        let lines = dehyphenate_and_split_lines(&raw_text, &line_boxes);

        extracted_pages.push(ExtractedPage {
            page_number: *page_num as usize,
            lines,
        });

        if current_page % 5 == 0 || current_page == total_pages {
            let pct = ((current_page as f32 / total_pages as f32) * 30.0).round() as u8;
            on_progress("extracting", current_page, total_pages, 0, 0, pct.max(1));
        }
    }

    // Immediate scanned-PDF / missing-text-spans check BEFORE chunking or calling ONNX/APIs
    if total_raw_alnum < 40 {
        return Err(SCANNED_PDF_ERROR.to_string());
    }

    // Strip repeating running headers/footers & standalone page numbers
    strip_running_headers_and_footers(&mut extracted_pages);

    // Filter non-content pages & bibliography sections, then chunk
    on_progress("chunking", total_pages, total_pages, 0, 0, 34);

    let chunk_size = config.chunk_size.max(4);
    let overlap = config.chunk_overlap.min(chunk_size.saturating_sub(1));
    let step = (chunk_size - overlap).max(1);

    let mut prepared_chunks: Vec<PreparedChunk> = Vec::new();
    let mut global_chunk_idx = 0usize;
    let mut in_references_section = false;

    for (page_idx, mut page) in extracted_pages.into_iter().enumerate() {
        if page.lines.is_empty() {
            continue;
        }
        if is_sparse_cover_or_meta_page(page_idx, &page.lines) {
            continue;
        }
        if is_toc_page(&page.lines) {
            continue;
        }
        if is_back_index_page(page_idx, total_pages, &page.lines) {
            continue;
        }

        // Detect References / Bibliography toward the second half of the document
        let can_enter_references =
            (total_pages <= 4 && page_idx >= 1) || page_idx >= total_pages / 2;

        if in_references_section {
            if let Some(app_pos) = page.lines.iter().position(|l| is_appendix_heading(&l.text)) {
                in_references_section = false;
                page.lines = page.lines.split_off(app_pos);
            } else {
                continue;
            }
        } else if can_enter_references {
            if let Some(ref_pos) = page
                .lines
                .iter()
                .position(|l| is_references_heading(&l.text))
            {
                page.lines.truncate(ref_pos);
                in_references_section = true;
                if page.lines.is_empty() {
                    continue;
                }
            }
        }

        let wrapped = wrap_long_lines(&page.lines, 120);
        if wrapped.is_empty() {
            continue;
        }

        let mut start = 0usize;
        while start < wrapped.len() {
            let end = (start + chunk_size).min(wrapped.len());
            let slice = &wrapped[start..end];
            let chunk_text = slice
                .iter()
                .map(|l| l.text.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            let alnum_count = chunk_text.chars().filter(|c| c.is_alphanumeric()).count();

            if alnum_count >= 24 {
                let rect_segments = merge_line_rects(slice);
                prepared_chunks.push(PreparedChunk {
                    chunk_id: format!("{}-chunk-{}", doc_id, global_chunk_idx),
                    page_number: page.page_number,
                    chunk_index: global_chunk_idx,
                    text: chunk_text,
                    rect_segments,
                });
                global_chunk_idx += 1;
            }

            if end == wrapped.len() {
                break;
            }
            start += step;
        }
    }

    if prepared_chunks.is_empty() {
        return Err(SCANNED_PDF_ERROR.to_string());
    }

    let total_chunks = prepared_chunks.len();
    on_progress("chunking", total_pages, total_pages, 0, total_chunks, 38);

    Ok((prepared_chunks, total_pages))
}
