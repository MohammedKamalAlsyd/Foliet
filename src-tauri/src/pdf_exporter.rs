use std::fs::{self, File};
use std::path::Path;

use lopdf::{Dictionary, Document, Object, Stream, StringFormat};

use crate::pdf_geometry::{
    PageGeometry, PdfRectBounds, normalized_point_to_pdf, normalized_rect_to_pdf,
};
use crate::pdf_models::AnnotationDto;
use crate::pdf_reader::compute_fast_doc_id;

fn hex_to_rgb(hex: &str) -> (f32, f32, f32) {
    let clean = hex.strip_prefix('#').unwrap_or(hex);
    if !clean.is_ascii() || clean.len() != 6 {
        return (0.98, 0.8, 0.08);
    }
    let parse = |range| u8::from_str_radix(&clean[range], 16).ok();
    match (parse(0..2), parse(2..4), parse(4..6)) {
        (Some(r), Some(g), Some(b)) => (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0),
        _ => (0.98, 0.8, 0.08),
    }
}

fn hex_to_raw_bytes(hex: &str) -> Vec<u8> {
    let bytes: Vec<u8> = hex
        .as_bytes()
        .chunks(2)
        .filter_map(|c| {
            let s = std::str::from_utf8(c).ok()?;
            u8::from_str_radix(s, 16).ok()
        })
        .collect();
    if bytes.is_empty() {
        hex.as_bytes().to_vec()
    } else {
        bytes
    }
}

struct MarkupGeometry {
    bbox: [f32; 4],
    quad_points: Vec<Object>,
    rects: Vec<PdfRectBounds>,
}

impl MarkupGeometry {
    fn from_annotation(annot: &AnnotationDto, geo: PageGeometry) -> Option<Self> {
        let mut quad_points = Vec::with_capacity(annot.rect_segments.len() * 8);
        let mut rects = Vec::with_capacity(annot.rect_segments.len());
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (
            f32::INFINITY,
            f32::INFINITY,
            f32::NEG_INFINITY,
            f32::NEG_INFINITY,
        );

        for seg in &annot.rect_segments {
            let r = normalized_rect_to_pdf(seg, geo)?;
            min_x = min_x.min(r.min_x);
            min_y = min_y.min(r.min_y);
            max_x = max_x.max(r.max_x);
            max_y = max_y.max(r.max_y);
            quad_points.extend(r.quad.iter().map(|&v| Object::Real(v)));
            rects.push(r);
        }

        (!quad_points.is_empty()).then_some(Self {
            bbox: [min_x, min_y, max_x, max_y],
            quad_points,
            rects,
        })
    }

    fn padded_bbox(&self, pad: f32) -> [f32; 4] {
        [
            self.bbox[0] - pad,
            self.bbox[1] - pad,
            self.bbox[2] + pad,
            self.bbox[3] + pad,
        ]
    }
}

fn attach_form_appearance(
    doc: &mut Document,
    bbox: [f32; 4],
    ap_ops: String,
    resources: Option<Dictionary>,
) -> Dictionary {
    let mut xobj = Dictionary::new();
    xobj.set("Type", Object::Name(b"XObject".to_vec()));
    xobj.set("Subtype", Object::Name(b"Form".to_vec()));
    xobj.set("FormType", Object::Integer(1));
    xobj.set(
        "BBox",
        Object::Array(bbox.iter().map(|&v| Object::Real(v)).collect()),
    );
    xobj.set(
        "Resources",
        Object::Dictionary(resources.unwrap_or_default()),
    );

    let stream_id = doc.add_object(Object::Stream(Stream::new(xobj, ap_ops.into_bytes())));
    let mut ap = Dictionary::new();
    ap.set("N", Object::Reference(stream_id));
    ap
}

fn create_base_dict(
    annot: &AnnotationDto,
    subtype: &'static [u8],
    rect: [f32; 4],
    ap: Dictionary,
) -> Dictionary {
    let (r, g, b) = hex_to_rgb(&annot.color);
    let mut dict = Dictionary::new();
    dict.set("Type", Object::Name(b"Annot".to_vec()));
    dict.set("Subtype", Object::Name(subtype.to_vec()));
    dict.set(
        "Rect",
        Object::Array(rect.iter().map(|&v| Object::Real(v)).collect()),
    );
    dict.set(
        "C",
        Object::Array(vec![Object::Real(r), Object::Real(g), Object::Real(b)]),
    );
    dict.set("F", Object::Integer(4)); // Bit 3: Print
    dict.set("AP", Object::Dictionary(ap));
    dict.set("NM", Object::string_literal(annot.id.clone()));

    if let Some(comment) = annot
        .comment
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        dict.set("Contents", Object::string_literal(comment));
    }
    dict
}

fn build_highlight(
    doc: &mut Document,
    annot: &AnnotationDto,
    geo: PageGeometry,
) -> Option<Dictionary> {
    let mg = MarkupGeometry::from_annotation(annot, geo)?;
    let (r, g, b) = hex_to_rgb(&annot.color);

    let mut gs0 = Dictionary::new();
    gs0.set("Type", Object::Name(b"ExtGState".to_vec()));
    gs0.set("BM", Object::Name(b"Multiply".to_vec()));
    gs0.set("ca", Object::Real(0.4));
    gs0.set("CA", Object::Real(0.4));

    let mut ext_gstate = Dictionary::new();
    ext_gstate.set("GS0", Object::Dictionary(gs0));
    let mut resources = Dictionary::new();
    resources.set("ExtGState", Object::Dictionary(ext_gstate));

    let mut ops = format!("q\n/GS0 gs\n{r:.3} {g:.3} {b:.3} rg\n");
    for rect in &mg.rects {
        ops.push_str(&format!(
            "{:.3} {:.3} {:.3} {:.3} re\nf\n",
            rect.min_x,
            rect.min_y,
            rect.max_x - rect.min_x,
            rect.max_y - rect.min_y
        ));
    }
    ops.push_str("Q\n");

    let ap = attach_form_appearance(doc, mg.bbox, ops, Some(resources));
    let mut dict = create_base_dict(annot, b"Highlight", mg.bbox, ap);
    dict.set("Subj", Object::string_literal("Highlight"));
    dict.set("QuadPoints", Object::Array(mg.quad_points));
    dict.set("CA", Object::Real(0.4));
    Some(dict)
}

fn build_underline(
    doc: &mut Document,
    annot: &AnnotationDto,
    geo: PageGeometry,
) -> Option<Dictionary> {
    let mg = MarkupGeometry::from_annotation(annot, geo)?;
    let (r, g, b) = hex_to_rgb(&annot.color);
    let style = annot.underline_style.as_deref().unwrap_or("solid");

    let mut ops = format!("q\n{r:.3} {g:.3} {b:.3} RG\n1 J 1 j\n");
    match style {
        "squiggle" => {
            ops.push_str("1.5 w\n");
            for rect in &mg.rects {
                let (sx, ex) = if rect.p_bl.0 <= rect.p_br.0 {
                    (rect.p_bl.0, rect.p_br.0)
                } else {
                    (rect.p_br.0, rect.p_bl.0)
                };
                render_squiggle(&mut ops, sx, ex, rect.p_bl.1 + 1.2);
            }
        }
        other => {
            ops.push_str(if other == "dashed" {
                "1.5 w\n[4 3] 0 d\n"
            } else {
                "1.8 w\n"
            });
            for rect in &mg.rects {
                ops.push_str(&format!(
                    "{:.3} {:.3} m {:.3} {:.3} l S\n",
                    rect.p_bl.0,
                    rect.p_bl.1 + 1.2,
                    rect.p_br.0,
                    rect.p_br.1 + 1.2
                ));
            }
        }
    }
    ops.push_str("Q\n");

    let ap = attach_form_appearance(doc, mg.padded_bbox(3.0), ops, None);
    let subtype: &'static [u8] = if style == "squiggle" {
        b"Squiggly"
    } else {
        b"Underline"
    };
    let mut dict = create_base_dict(annot, subtype, mg.bbox, ap);
    dict.set("QuadPoints", Object::Array(mg.quad_points));
    Some(dict)
}

fn render_squiggle(ops: &mut String, start_x: f32, end_x: f32, base_y: f32) {
    let (mut cur_x, mut up) = (start_x, true);
    ops.push_str(&format!("{start_x:.3} {base_y:.3} m\n"));
    while cur_x < end_x {
        let next_x = (cur_x + 4.0).min(end_x);
        let mid_x = (cur_x + next_x) / 2.0;
        let peak_y = base_y + if up { 1.5 } else { -1.5 };
        let k = 2.0 / 3.0;
        ops.push_str(&format!(
            "{:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c\n",
            cur_x + k * (mid_x - cur_x),
            base_y + k * (peak_y - base_y),
            next_x + k * (mid_x - next_x),
            base_y + k * (peak_y - base_y),
            next_x,
            base_y
        ));
        cur_x = next_x;
        up = !up;
    }
    ops.push_str("S\n");
}

fn build_strikeout(
    doc: &mut Document,
    annot: &AnnotationDto,
    geo: PageGeometry,
) -> Option<Dictionary> {
    let mg = MarkupGeometry::from_annotation(annot, geo)?;
    let (r, g, b) = hex_to_rgb(&annot.color);

    let mut ops = format!("q\n{r:.3} {g:.3} {b:.3} RG\n1.8 w\n1 J 1 j\n");
    for rect in &mg.rects {
        ops.push_str(&format!(
            "{:.3} {:.3} m {:.3} {:.3} l S\n",
            (rect.p_tl.0 + rect.p_bl.0) / 2.0,
            (rect.p_tl.1 + rect.p_bl.1) / 2.0,
            (rect.p_tr.0 + rect.p_br.0) / 2.0,
            (rect.p_tr.1 + rect.p_br.1) / 2.0
        ));
    }
    ops.push_str("Q\n");

    let ap = attach_form_appearance(doc, mg.padded_bbox(2.0), ops, None);
    let mut dict = create_base_dict(annot, b"StrikeOut", mg.bbox, ap);
    dict.set("QuadPoints", Object::Array(mg.quad_points));
    Some(dict)
}

fn build_ink(doc: &mut Document, annot: &AnnotationDto, geo: PageGeometry) -> Option<Dictionary> {
    if annot.points.len() < 2 {
        return None;
    }

    let mut pts = Vec::with_capacity(annot.points.len());
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f32::INFINITY,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NEG_INFINITY,
    );

    for pt in &annot.points {
        let (px, py) = normalized_point_to_pdf(pt.x, pt.y, geo)?;
        min_x = min_x.min(px);
        min_y = min_y.min(py);
        max_x = max_x.max(px);
        max_y = max_y.max(py);
        pts.push((px, py));
    }

    let stroke_width = annot.stroke_width.unwrap_or(2.0).max(0.5);
    let pad = (stroke_width / 2.0).max(2.0);
    let (r, g, b) = hex_to_rgb(&annot.color);
    let rect = [min_x - pad, min_y - pad, max_x + pad, max_y + pad];

    let mut ops = format!("q\n{r:.3} {g:.3} {b:.3} RG\n{stroke_width:.2} w\n1 J 1 j\n");
    for (i, (px, py)) in pts.iter().enumerate() {
        let cmd = if i == 0 { 'm' } else { 'l' };
        ops.push_str(&format!("{px:.3} {py:.3} {cmd}\n"));
    }
    ops.push_str("S\nQ\n");

    let ap = attach_form_appearance(doc, rect, ops, None);
    let ink_coords = pts
        .iter()
        .flat_map(|&(x, y)| [Object::Real(x), Object::Real(y)])
        .collect();

    let mut bs = Dictionary::new();
    bs.set("Type", Object::Name(b"Border".to_vec()));
    bs.set("W", Object::Real(stroke_width));
    bs.set("S", Object::Name(b"S".to_vec()));

    let mut dict = create_base_dict(annot, b"Ink", rect, ap);
    dict.set("InkList", Object::Array(vec![Object::Array(ink_coords)]));
    dict.set("BS", Object::Dictionary(bs));
    Some(dict)
}

fn build_note(doc: &mut Document, annot: &AnnotationDto, geo: PageGeometry) -> Option<Dictionary> {
    let (cx, py) = normalized_point_to_pdf(annot.x.unwrap_or(0.1), annot.y.unwrap_or(0.1), geo)?;
    let rect = [cx - 10.0, py, cx + 10.0, py + 20.0];
    let (r, g, b) = hex_to_rgb(&annot.color);
    let cy = py + 13.0;
    let (ir, ik) = (2.4_f32, 2.4 * 0.55228475);

    let ops = format!(
        "q\n{r:.3} {g:.3} {b:.3} rg\n0.15 0.15 0.15 RG\n1.0 w\n\
         {cx:.3} {p1:.3} m\n\
         {cx3:.3} {p5:.3} {cx6:.3} {cy_m2:.3} {cx6:.3} {cy:.3} c\n\
         {cx6:.3} {cy_p33:.3} {cx33:.3} {cy_p6:.3} {cx:.3} {cy_p6:.3} c\n\
         {cx_m33:.3} {cy_p6:.3} {cx_m6:.3} {cy_p33:.3} {cx_m6:.3} {cy:.3} c\n\
         {cx_m6:.3} {cy_m2:.3} {cx_m3:.3} {p5:.3} {cx:.3} {p1:.3} c\nB\n\
         1.0 1.0 1.0 rg\n{ix_p:.3} {cy:.3} m\n\
         {ix_p:.3} {iy_pk:.3} {ix_pk:.3} {iy_p:.3} {cx:.3} {iy_p:.3} c\n\
         {ix_mk:.3} {iy_p:.3} {ix_m:.3} {iy_pk:.3} {ix_m:.3} {cy:.3} c\n\
         {ix_m:.3} {iy_mk:.3} {ix_mk:.3} {iy_m:.3} {cx:.3} {iy_m:.3} c\n\
         {ix_pk:.3} {iy_m:.3} {ix_p:.3} {iy_mk:.3} {ix_p:.3} {cy:.3} c\nf\nQ\n",
        p1 = py + 1.0,
        p5 = py + 5.0,
        cx3 = cx + 3.0,
        cx6 = cx + 6.0,
        cx33 = cx + 3.3,
        cx_m3 = cx - 3.0,
        cx_m6 = cx - 6.0,
        cx_m33 = cx - 3.3,
        cy_m2 = cy - 2.0,
        cy_p33 = cy + 3.3,
        cy_p6 = cy + 6.0,
        ix_p = cx + ir,
        ix_m = cx - ir,
        ix_pk = cx + ik,
        ix_mk = cx - ik,
        iy_p = cy + ir,
        iy_m = cy - ir,
        iy_pk = cy + ik,
        iy_mk = cy - ik,
    );

    let bbox = [rect[0] - 2.0, rect[1] - 2.0, rect[2] + 2.0, rect[3] + 2.0];
    let ap = attach_form_appearance(doc, bbox, ops, None);

    let mut dict = create_base_dict(annot, b"Text", rect, ap);
    dict.set("Name", Object::Name(b"Comment".to_vec()));
    dict.set("Open", Object::Boolean(false));
    dict.set(
        "Contents",
        Object::string_literal(annot.comment.clone().unwrap_or_default()),
    );
    Some(dict)
}

fn is_visual_annotation(doc: &Document, obj: &Object) -> bool {
    let dict = match obj {
        Object::Reference(id) => doc.get_object(*id).and_then(Object::as_dict).ok(),
        Object::Dictionary(d) => Some(d),
        _ => None,
    };
    matches!(
        dict.and_then(|d| d.get(b"Subtype").and_then(Object::as_name).ok()),
        Some(
            b"Highlight" | b"Underline" | b"Squiggly" | b"StrikeOut" | b"Ink" | b"Text" | b"Popup"
        )
    )
}

pub fn burn_annotations_to_file(
    source_path: &Path,
    target_path: &Path,
    annotations: &[AnnotationDto],
) -> Result<(), String> {
    let mut doc = Document::load(source_path)
        .map_err(|e| format!("Failed to load PDF '{}': {:?}", source_path.display(), e))?;

    // Lock trailer /ID so saving never causes Foliet's doc_id to drift
    if doc.trailer.get(b"ID").is_err() {
        let mut f = File::open(source_path)
            .map_err(|e| format!("Failed to open '{}': {}", source_path.display(), e))?;
        let size = f.metadata().map_err(|e| e.to_string())?.len();
        let permanent_id = compute_fast_doc_id(&mut f, size)?;
        let raw = hex_to_raw_bytes(permanent_id.strip_prefix("doc-").unwrap_or(&permanent_id));
        doc.trailer.set(
            "ID",
            Object::Array(vec![
                Object::String(raw.clone(), StringFormat::Hexadecimal),
                Object::String(raw, StringFormat::Hexadecimal),
            ]),
        );
    }

    let pages: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();

    for (page_num, page_id) in pages {
        let geo = PageGeometry::from_page(&doc, page_id);

        let mut kept_annots: Vec<Object> = {
            let Ok(page_dict) = doc.get_object(page_id).and_then(Object::as_dict) else {
                continue;
            };
            match page_dict.get(b"Annots") {
                Ok(Object::Array(arr)) => arr
                    .iter()
                    .filter(|item| !is_visual_annotation(&doc, item))
                    .cloned()
                    .collect(),
                Ok(Object::Reference(arr_id)) => {
                    match doc.get_object(*arr_id).and_then(Object::as_array) {
                        Ok(arr) => arr
                            .iter()
                            .filter(|item| !is_visual_annotation(&doc, item))
                            .cloned()
                            .collect(),
                        Err(_) => Vec::new(),
                    }
                }
                _ => Vec::new(),
            }
        };

        for annot in annotations
            .iter()
            .filter(|a| a.page_number == page_num as usize)
        {
            let dict = match annot.tool_type.as_str() {
                "highlight" => build_highlight(&mut doc, annot, geo),
                "underline" => build_underline(&mut doc, annot, geo),
                "strikethrough" => build_strikeout(&mut doc, annot, geo),
                "freehand_write" => build_ink(&mut doc, annot, geo),
                "popup_note" => build_note(&mut doc, annot, geo),
                _ => None,
            };
            if let Some(d) = dict {
                let id = doc.add_object(Object::Dictionary(d));
                kept_annots.push(Object::Reference(id));
            }
        }

        if let Ok(page_dict) = doc.get_object_mut(page_id).and_then(Object::as_dict_mut) {
            if kept_annots.is_empty() {
                page_dict.remove(b"Annots");
            } else {
                page_dict.set("Annots", Object::Array(kept_annots));
            }
        }
    }

    let mut output = Vec::new();
    doc.save_to(&mut output)
        .map_err(|e| format!("Failed to serialize PDF: {:?}", e))?;

    fs::write(target_path, &output)
        .map_err(|e| format!("Failed to write '{}': {}", target_path.display(), e))
}
