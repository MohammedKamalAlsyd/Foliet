use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationDto {
    pub id: String,
    pub page_number: usize,
    pub tool_type: String,
    pub color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default)]
    pub rect_segments: Vec<BoundingBox>,
    #[serde(default)]
    pub points: Vec<Point>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOpenResult {
    pub doc_id: String,
    pub file_name: String,
    pub file_path: String,
    pub file_size: u64,
    pub num_pages: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extracted_annotations: Option<Vec<AnnotationDto>>,
}
