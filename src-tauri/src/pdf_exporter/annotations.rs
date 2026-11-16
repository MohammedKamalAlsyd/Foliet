use crate::pdf_exporter::geometry::{MarkupGeometry, PageGeometry, normalized_point_to_pdf};
use crate::pdf_models::AnnotationDto;
use lopdf::{Dictionary, Document, Object, Stream};

fn hex_to_rgb(hex: &str) -> (f32, f32, f32) {
    let clean = hex.strip_prefix('#').unwrap_or(hex);
    if clean.len() != 6 {
        return (0.98, 0.8, 0.08);
    }
    let r = u8::from_str_radix(&clean[0..2], 16).unwrap_or(250) as f32 / 255.0;
    let g = u8::from_str_radix(&clean[2..4], 16).unwrap_or(204) as f32 / 255.0;
    let b = u8::from_str_radix(&clean[4..6], 16).unwrap_or(21) as f32 / 255.0;
    (r, g, b)
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
    annotation: &AnnotationDto,
    subtype: &'static [u8],
    rect: [f32; 4],
    ap_dict: Dictionary,
) -> Dictionary {
    let (r, g, b) = hex_to_rgb(&annotation.color);

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
    dict.set("F", Object::Integer(4));
    dict.set("AP", Object::Dictionary(ap_dict));
    dict.set("NM", Object::string_literal(annotation.id.clone()));

    if let Some(comment) = &annotation.comment {
        if !comment.trim().is_empty() {
            dict.set("Contents", Object::string_literal(comment.clone()));
        }
    }

    dict
}

pub fn create_highlight(
    doc: &mut Document,
    annotation: &AnnotationDto,
    geometry: PageGeometry,
) -> Option<Dictionary> {
    let mg = MarkupGeometry::from_annotation(annotation, geometry)?;
    let (r, g, b) = hex_to_rgb(&annotation.color);

    let mut gs0 = Dictionary::new();
    gs0.set("Type", Object::Name(b"ExtGState".to_vec()));
    gs0.set("BM", Object::Name(b"Multiply".to_vec()));
    gs0.set("ca", Object::Real(0.4));
    gs0.set("CA", Object::Real(0.4));

    let mut ext_gstate = Dictionary::new();
    ext_gstate.set("GS0", Object::Dictionary(gs0));
    let mut resources = Dictionary::new();
    resources.set("ExtGState", Object::Dictionary(ext_gstate));

    let mut ap_ops = format!("q\n/GS0 gs\n{:.3} {:.3} {:.3} rg\n", r, g, b);
    for rect in &mg.rects {
        ap_ops.push_str(&format!(
            "{:.3} {:.3} {:.3} {:.3} re\nf\n",
            rect.min_x,
            rect.min_y,
            rect.max_x - rect.min_x,
            rect.max_y - rect.min_y
        ));
    }
    ap_ops.push_str("Q\n");

    let ap = attach_form_appearance(doc, mg.bbox(), ap_ops, Some(resources));
    let mut dict = create_base_dict(annotation, b"Highlight", mg.bbox(), ap);
    dict.set("Subj", Object::string_literal("Highlight"));
    dict.set("QuadPoints", Object::Array(mg.quad_points));
    dict.set("CA", Object::Real(0.4));
    Some(dict)
}

pub fn create_underline(
    doc: &mut Document,
    annotation: &AnnotationDto,
    geometry: PageGeometry,
) -> Option<Dictionary> {
    let mg = MarkupGeometry::from_annotation(annotation, geometry)?;
    let (r, g, b) = hex_to_rgb(&annotation.color);
    let style = annotation.underline_style.as_deref().unwrap_or("solid");

    let mut ap_ops = format!("q\n{:.3} {:.3} {:.3} RG\n1 J 1 j\n", r, g, b);
    match style {
        "dashed" => {
            ap_ops.push_str("1.5 w\n[4 3] 0 d\n");
            for r in &mg.rects {
                ap_ops.push_str(&format!(
                    "{:.3} {:.3} m {:.3} {:.3} l S\n",
                    r.p_bl.0,
                    r.p_bl.1 + 1.2,
                    r.p_br.0,
                    r.p_br.1 + 1.2
                ));
            }
        }
        "squiggle" => {
            ap_ops.push_str("1.5 w\n");
            for r in &mg.rects {
                render_squiggle(&mut ap_ops, r.p_bl.0, r.p_br.0, r.p_bl.1 + 1.2);
            }
        }
        _ => {
            ap_ops.push_str("1.8 w\n");
            for r in &mg.rects {
                ap_ops.push_str(&format!(
                    "{:.3} {:.3} m {:.3} {:.3} l S\n",
                    r.p_bl.0,
                    r.p_bl.1 + 1.2,
                    r.p_br.0,
                    r.p_br.1 + 1.2
                ));
            }
        }
    }
    ap_ops.push_str("Q\n");

    let pad = 3.0;
    let bbox = [
        mg.min_x - pad,
        mg.min_y - pad,
        mg.max_x + pad,
        mg.max_y + pad,
    ];
    let ap = attach_form_appearance(doc, bbox, ap_ops, None);
    let subtype: &'static [u8] = if style == "squiggle" {
        b"Squiggly"
    } else {
        b"Underline"
    };

    let mut dict = create_base_dict(annotation, subtype, mg.bbox(), ap);
    dict.set("QuadPoints", Object::Array(mg.quad_points));
    Some(dict)
}

fn render_squiggle(ops: &mut String, start_x: f32, end_x: f32, base_y: f32) {
    let step = 4.0;
    let mut cur_x = start_x;
    let mut up = true;

    ops.push_str(&format!("{:.3} {:.3} m\n", start_x, base_y));
    while cur_x < end_x {
        let next_x = (cur_x + step).min(end_x);
        let mid_x = (cur_x + next_x) / 2.0;
        let peak_y = if up { base_y + 1.5 } else { base_y - 1.5 };

        let cp1_x = cur_x + (2.0 / 3.0) * (mid_x - cur_x);
        let cp1_y = base_y + (2.0 / 3.0) * (peak_y - base_y);
        let cp2_x = next_x + (2.0 / 3.0) * (mid_x - next_x);
        let cp2_y = base_y + (2.0 / 3.0) * (peak_y - base_y);

        ops.push_str(&format!(
            "{:.3} {:.3} {:.3} {:.3} {:.3} {:.3} c\n",
            cp1_x, cp1_y, cp2_x, cp2_y, next_x, base_y
        ));
        cur_x = next_x;
        up = !up;
    }
    ops.push_str("S\n");
}

pub fn create_strikeout(
    doc: &mut Document,
    annotation: &AnnotationDto,
    geometry: PageGeometry,
) -> Option<Dictionary> {
    let mg = MarkupGeometry::from_annotation(annotation, geometry)?;
    let (r, g, b) = hex_to_rgb(&annotation.color);

    let mut ap_ops = format!("q\n{:.3} {:.3} {:.3} RG\n1.8 w\n1 J 1 j\n", r, g, b);
    for r in &mg.rects {
        let sx = (r.p_tl.0 + r.p_bl.0) / 2.0;
        let sy = (r.p_tl.1 + r.p_bl.1) / 2.0;
        let ex = (r.p_tr.0 + r.p_br.0) / 2.0;
        let ey = (r.p_tr.1 + r.p_br.1) / 2.0;
        ap_ops.push_str(&format!("{:.3} {:.3} m {:.3} {:.3} l S\n", sx, sy, ex, ey));
    }
    ap_ops.push_str("Q\n");

    let pad = 2.0;
    let bbox = [
        mg.min_x - pad,
        mg.min_y - pad,
        mg.max_x + pad,
        mg.max_y + pad,
    ];
    let ap = attach_form_appearance(doc, bbox, ap_ops, None);

    let mut dict = create_base_dict(annotation, b"StrikeOut", mg.bbox(), ap);
    dict.set("QuadPoints", Object::Array(mg.quad_points));
    Some(dict)
}

pub fn create_ink(
    doc: &mut Document,
    annotation: &AnnotationDto,
    geometry: PageGeometry,
) -> Option<Dictionary> {
    if annotation.points.len() < 2 {
        return None;
    }

    let mut pts = Vec::with_capacity(annotation.points.len());
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (
        f32::INFINITY,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NEG_INFINITY,
    );

    for pt in &annotation.points {
        let (px, py) = normalized_point_to_pdf(pt.x, pt.y, geometry)?;
        min_x = min_x.min(px);
        min_y = min_y.min(py);
        max_x = max_x.max(px);
        max_y = max_y.max(py);
        pts.push((px, py));
    }
    if pts.len() < 2 {
        return None;
    }

    let stroke_width = annotation.stroke_width.unwrap_or(2.0).max(0.5);
    let pad = (stroke_width / 2.0).max(2.0);
    let (r, g, b) = hex_to_rgb(&annotation.color);
    let rect = [min_x - pad, min_y - pad, max_x + pad, max_y + pad];

    let mut ap_ops = format!(
        "q\n{:.3} {:.3} {:.3} RG\n{:.2} w\n1 J 1 j\n",
        r, g, b, stroke_width
    );
    for (i, (px, py)) in pts.iter().enumerate() {
        let cmd = if i == 0 { 'm' } else { 'l' };
        ap_ops.push_str(&format!("{:.3} {:.3} {}\n", px, py, cmd));
    }
    ap_ops.push_str("S\nQ\n");

    let ap = attach_form_appearance(doc, rect, ap_ops, None);
    let ink_coords = pts
        .iter()
        .flat_map(|(x, y)| [Object::Real(*x), Object::Real(*y)])
        .collect();

    let mut bs = Dictionary::new();
    bs.set("Type", Object::Name(b"Border".to_vec()));
    bs.set("W", Object::Real(stroke_width));
    bs.set("S", Object::Name(b"S".to_vec()));

    let mut dict = create_base_dict(annotation, b"Ink", rect, ap);
    dict.set("InkList", Object::Array(vec![Object::Array(ink_coords)]));
    dict.set("BS", Object::Dictionary(bs));
    Some(dict)
}

pub fn create_note(
    doc: &mut Document,
    annotation: &AnnotationDto,
    geometry: PageGeometry,
) -> Option<Dictionary> {
    let (pdf_x, pdf_y) = normalized_point_to_pdf(
        annotation.x.unwrap_or(0.1),
        annotation.y.unwrap_or(0.1),
        geometry,
    )?;
    let rect = [pdf_x - 10.0, pdf_y - 10.0, pdf_x + 10.0, pdf_y + 10.0];
    let (r, g, b) = hex_to_rgb(&annotation.color);
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;
    let (lr, lg, lb) = if luma > 0.55 {
        (0.12, 0.12, 0.14)
    } else {
        (1.0, 1.0, 1.0)
    };

    let (x0, x1) = (pdf_x - 8.5, pdf_x + 8.5);
    let (y_bot, y_top) = (pdf_y - 5.5, pdf_y + 8.5);
    let (cr, ck) = (2.4, 2.4 * 0.55228475);
    let y_mid = (y_bot + y_top) / 2.0;

    let ops = format!(
        "q\n{r:.3} {g:.3} {b:.3} rg\n0.15 0.15 0.15 RG\n0.85 w\n1 J 1 j\n\
         {sx:.3} {y_bot:.3} m\n\
         {txl:.3} {y_bot:.3} l\n\
         {pdf_x:.3} {tip_y:.3} l\n\
         {txr:.3} {y_bot:.3} l\n\
         {bxr:.3} {y_bot:.3} l\n\
         {br1x:.3} {y_bot:.3} {x1:.3} {br2y:.3} {x1:.3} {yb_c:.3} c\n\
         {x1:.3} {yt_c:.3} l\n\
         {x1:.3} {tr1y:.3} {tr2x:.3} {y_top:.3} {bxr:.3} {y_top:.3} c\n\
         {sx:.3} {y_top:.3} l\n\
         {tl1x:.3} {y_top:.3} {x0:.3} {tl2y:.3} {x0:.3} {yt_c:.3} c\n\
         {x0:.3} {yb_c:.3} l\n\
         {x0:.3} {bl1y:.3} {bl2x:.3} {y_bot:.3} {sx:.3} {y_bot:.3} c\nB\n\
         {lr:.3} {lg:.3} {lb:.3} RG\n1.2 w\n\
         {lx0:.3} {ly1:.3} m {lx1:.3} {ly1:.3} l S\n\
         {lx0:.3} {ly2:.3} m {lx2:.3} {ly2:.3} l S\nQ\n",
        sx = x0 + cr,
        txl = pdf_x - 2.4,
        tip_y = pdf_y + -9.0,
        txr = pdf_x + 2.4,
        bxr = x1 - cr,
        br1x = x1 - cr + ck,
        br2y = y_bot + cr - ck,
        yb_c = y_bot + cr,
        yt_c = y_top - cr,
        tr1y = y_top - cr + ck,
        tr2x = x1 - cr + ck,
        tl1x = x0 + cr - ck,
        tl2y = y_top - cr + ck,
        bl1y = y_bot + cr - ck,
        bl2x = x0 + cr - ck,
        lx0 = x0 + 3.5,
        lx1 = x1 - 3.5,
        lx2 = x1 - 5.5,
        ly1 = y_mid + 2.0,
        ly2 = y_mid - 1.6,
    );

    let pad = 2.0;
    let bbox = [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad];
    let ap = attach_form_appearance(doc, bbox, ops, None);

    let mut dict = create_base_dict(annotation, b"Text", rect, ap);
    dict.set("Name", Object::Name(b"Comment".to_vec()));
    dict.set("Open", Object::Boolean(false));
    dict.set(
        "Contents",
        Object::string_literal(annotation.comment.clone().unwrap_or_default()),
    );
    Some(dict)
}
