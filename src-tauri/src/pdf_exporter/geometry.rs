use crate::pdf_models::{AnnotationDto, BoundingBox};
use lopdf::{Document, Object, ObjectId};

#[derive(Copy, Clone, Debug)]
pub struct PageGeometry {
    pub left: f32,
    pub bottom: f32,
    pub width: f32,
    pub height: f32,
    pub rotation: i64,
}

impl PageGeometry {
    pub fn from_page(doc: &Document, page_id: ObjectId) -> Self {
        let rotation = Self::resolve_rotation(doc, page_id);
        let (left, bottom, width, height) = Self::resolve_box(doc, page_id);

        Self {
            left,
            bottom,
            width,
            height,
            rotation: rotation.rem_euclid(360),
        }
    }

    fn resolve_rotation(doc: &Document, mut obj_id: ObjectId) -> i64 {
        for _ in 0..16 {
            let Ok(dict) = doc.get_object(obj_id).and_then(|o| o.as_dict()) else {
                break;
            };
            if let Ok(rot) = dict.get(b"Rotate").and_then(|o| o.as_i64()) {
                return rot;
            }
            let Ok(parent_ref) = dict.get(b"Parent").and_then(|o| o.as_reference()) else {
                break;
            };
            obj_id = parent_ref;
        }
        0
    }

    fn resolve_box(doc: &Document, mut obj_id: ObjectId) -> (f32, f32, f32, f32) {
        for _ in 0..16 {
            let Ok(dict) = doc.get_object(obj_id).and_then(|o| o.as_dict()) else {
                break;
            };
            let box_obj = dict.get(b"CropBox").or_else(|_| dict.get(b"MediaBox"));
            if let Ok(Object::Array(arr)) = box_obj {
                let coords: Vec<f32> = arr.iter().filter_map(|item| item.as_float().ok()).collect();
                if coords.len() == 4 {
                    let x1 = coords[0].min(coords[2]);
                    let y1 = coords[1].min(coords[3]);
                    let x2 = coords[0].max(coords[2]);
                    let y2 = coords[1].max(coords[3]);
                    return (x1, y1, (x2 - x1).max(1.0), (y2 - y1).max(1.0));
                }
            }
            let Ok(parent_ref) = dict.get(b"Parent").and_then(|o| o.as_reference()) else {
                break;
            };
            obj_id = parent_ref;
        }
        (0.0, 0.0, 612.0, 792.0)
    }
}

pub fn normalized_point_to_pdf(x: f32, y: f32, geo: PageGeometry) -> Option<(f32, f32)> {
    if !x.is_finite() || !y.is_finite() || geo.width <= 0.0 || geo.height <= 0.0 {
        return None;
    }

    let (local_x, local_y) = match geo.rotation {
        90 => (y * geo.width, x * geo.height),
        180 => ((1.0 - x) * geo.width, y * geo.height),
        270 => ((1.0 - y) * geo.width, (1.0 - x) * geo.height),
        _ => (x * geo.width, (1.0 - y) * geo.height),
    };

    Some((geo.left + local_x, geo.bottom + local_y))
}

pub fn pdf_point_to_normalized(pdf_x: f32, pdf_y: f32, geo: PageGeometry) -> Option<(f32, f32)> {
    if !pdf_x.is_finite() || !pdf_y.is_finite() || geo.width <= 0.0 || geo.height <= 0.0 {
        return None;
    }

    let local_x = pdf_x - geo.left;
    let local_y = pdf_y - geo.bottom;

    let (norm_x, norm_y) = match geo.rotation {
        90 => (local_y / geo.height, local_x / geo.width),
        180 => (1.0 - (local_x / geo.width), local_y / geo.height),
        270 => (1.0 - (local_y / geo.height), 1.0 - (local_x / geo.width)),
        _ => (local_x / geo.width, 1.0 - (local_y / geo.height)),
    };

    Some((norm_x.clamp(0.0, 1.0), norm_y.clamp(0.0, 1.0)))
}

#[derive(Clone, Debug)]
pub struct PdfRectBounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
    pub quad: [f32; 8],
    pub p_tl: (f32, f32),
    pub p_tr: (f32, f32),
    pub p_bl: (f32, f32),
    pub p_br: (f32, f32),
}

pub fn normalized_rect_to_pdf(seg: &BoundingBox, geo: PageGeometry) -> Option<PdfRectBounds> {
    let p_tl = normalized_point_to_pdf(seg.x, seg.y, geo)?;
    let p_tr = normalized_point_to_pdf(seg.x + seg.width, seg.y, geo)?;
    let p_bl = normalized_point_to_pdf(seg.x, seg.y + seg.height, geo)?;
    let p_br = normalized_point_to_pdf(seg.x + seg.width, seg.y + seg.height, geo)?;

    Some(PdfRectBounds {
        min_x: p_tl.0.min(p_tr.0).min(p_bl.0).min(p_br.0),
        min_y: p_tl.1.min(p_tr.1).min(p_bl.1).min(p_br.1),
        max_x: p_tl.0.max(p_tr.0).max(p_bl.0).max(p_br.0),
        max_y: p_tl.1.max(p_tr.1).max(p_bl.1).max(p_br.1),
        quad: [
            p_tl.0, p_tl.1, p_tr.0, p_tr.1, p_bl.0, p_bl.1, p_br.0, p_br.1,
        ],
        p_tl,
        p_tr,
        p_bl,
        p_br,
    })
}

pub struct MarkupGeometry {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
    pub quad_points: Vec<Object>,
    pub rects: Vec<PdfRectBounds>,
}

impl MarkupGeometry {
    pub fn from_annotation(annotation: &AnnotationDto, geometry: PageGeometry) -> Option<Self> {
        if annotation.rect_segments.is_empty() {
            return None;
        }

        let mut quad_points = Vec::with_capacity(annotation.rect_segments.len() * 8);
        let mut rects = Vec::with_capacity(annotation.rect_segments.len());
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (
            f32::INFINITY,
            f32::INFINITY,
            f32::NEG_INFINITY,
            f32::NEG_INFINITY,
        );

        for seg in &annotation.rect_segments {
            let rect = normalized_rect_to_pdf(seg, geometry)?;
            min_x = min_x.min(rect.min_x);
            min_y = min_y.min(rect.min_y);
            max_x = max_x.max(rect.max_x);
            max_y = max_y.max(rect.max_y);
            quad_points.extend(rect.quad.iter().copied().map(Object::Real));
            rects.push(rect);
        }

        (!quad_points.is_empty()).then_some(Self {
            min_x,
            min_y,
            max_x,
            max_y,
            quad_points,
            rects,
        })
    }

    pub fn bbox(&self) -> [f32; 4] {
        [self.min_x, self.min_y, self.max_x, self.max_y]
    }
}
