use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use lopdf::{Document, Object, ObjectId, content::Content};

use super::models::RagHyperparameters;

#[derive(Debug, Clone)]
pub struct ExtractedPage {
    pub page_number: usize,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PreparedChunk {
    pub chunk_id: String,
    pub page_number: usize,
    pub chunk_index: usize,
    pub text: String,
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

/// Dehyphenates wrapped line breaks (`word-\nbreak` -> `wordbreak`) and cleans lines.
fn dehyphenate_and_split_lines(raw_text: &str) -> Vec<String> {
    let raw_lines: Vec<String> = raw_text
        .lines()
        .map(normalize_inline_whitespace)
        .filter(|l| !l.is_empty())
        .collect();

    let mut merged: Vec<String> = Vec::with_capacity(raw_lines.len());
    for line in raw_lines {
        if let Some(prev) = merged.last_mut() {
            let prev_trimmed = prev.trim_end();
            let ends_with_hyphen = prev_trimmed.ends_with('-')
                && prev_trimmed.len() >= 2
                && prev_trimmed[..prev_trimmed.len() - 1]
                    .chars()
                    .last()
                    .is_some_and(|c| c.is_ascii_alphabetic());
            let starts_with_lower = line.chars().next().is_some_and(|c| c.is_ascii_lowercase());

            if ends_with_hyphen && starts_with_lower {
                prev.truncate(prev_trimmed.len() - 1);
                prev.push_str(&line);
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
            p.lines.retain(|l| !is_standalone_page_number(l));
        }
        return;
    }

    let mut freq: HashMap<String, usize> = HashMap::new();
    for page in pages.iter() {
        let mut seen_on_page = BTreeSet::new();
        let n = page.lines.len();
        let candidate_indices: Vec<usize> = (0..n.min(2)).chain(n.saturating_sub(2)..n).collect();

        for idx in candidate_indices {
            let line = &page.lines[idx];
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
            let line = &page.lines[idx];
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
            if keep[idx] && !is_standalone_page_number(&line) {
                filtered.push(line);
            }
        }
        page.lines = filtered;
    }
}

fn is_sparse_cover_or_meta_page(page_index: usize, lines: &[String]) -> bool {
    if page_index > 2 {
        return false;
    }
    let joined = lines.join(" ");
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

fn is_toc_page(lines: &[String]) -> bool {
    if lines.is_empty() {
        return false;
    }
    let first_lines = lines
        .iter()
        .take(3)
        .map(|l| l.to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    let has_toc_heading = first_lines.contains("table of contents")
        || lines
            .first()
            .is_some_and(|l| l.trim().eq_ignore_ascii_case("contents"));

    let mut toc_like_lines = 0usize;
    for line in lines {
        let trimmed = line.trim();
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

fn is_back_index_page(page_index: usize, total_pages: usize, lines: &[String]) -> bool {
    if total_pages < 8 || page_index < (total_pages * 3) / 4 || lines.is_empty() {
        return false;
    }
    let starts_with_index = lines
        .first()
        .is_some_and(|l| l.trim().eq_ignore_ascii_case("index"));

    let mut locator_lines = 0usize;
    for line in lines {
        let t = line.trim();
        let has_comma_num =
            t.contains(',') && t.chars().rev().take(8).any(|c| c.is_ascii_digit()) && t.len() <= 90;
        if has_comma_num {
            locator_lines += 1;
        }
    }
    let ratio = locator_lines as f32 / lines.len().max(1) as f32;
    (starts_with_index && ratio >= 0.25) || ratio >= 0.48
}

/// Wraps overly long PDF lines (~120 chars) so line-based chunking stays uniform.
fn wrap_long_lines(lines: &[String], max_line_chars: usize) -> Vec<String> {
    let mut wrapped = Vec::with_capacity(lines.len());
    for line in lines {
        if line.len() <= max_line_chars {
            wrapped.push(line.clone());
            continue;
        }
        let mut current = String::new();
        for word in line.split_whitespace() {
            if !current.is_empty() && current.len() + 1 + word.len() > max_line_chars {
                wrapped.push(current);
                current = String::new();
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        if !current.is_empty() {
            wrapped.push(current);
        }
    }
    wrapped
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
        let lines = dehyphenate_and_split_lines(&raw_text);

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
            if let Some(app_pos) = page.lines.iter().position(|l| is_appendix_heading(l)) {
                in_references_section = false;
                page.lines = page.lines.split_off(app_pos);
            } else {
                continue;
            }
        } else if can_enter_references {
            if let Some(ref_pos) = page.lines.iter().position(|l| is_references_heading(l)) {
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
            let chunk_text = wrapped[start..end].join("\n");
            let alnum_count = chunk_text.chars().filter(|c| c.is_alphanumeric()).count();

            if alnum_count >= 24 {
                prepared_chunks.push(PreparedChunk {
                    chunk_id: format!("{}-chunk-{}", doc_id, global_chunk_idx),
                    page_number: page.page_number,
                    chunk_index: global_chunk_idx,
                    text: chunk_text,
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
