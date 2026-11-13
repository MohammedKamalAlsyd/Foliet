/**
 * Foliet - PDF Annotation & Geometry Types
 * Note: Field names and `toolType` discriminants match the Rust serde contract.
 */
import type { UnderlineStyle } from "./tools";

export interface Point {
    x: number;
    y: number;
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface BaseAnnotation {
    id: string;
    pageNumber: number;
    color: string;
    createdAt: string;
    x: number;
    y: number;
    author?: string;
    isIsoAnnot?: boolean;
}

export interface TextMarkupAnnotation extends BaseAnnotation {
    toolType: "highlight" | "underline" | "strikethrough";
    text: string;
    rectSegments: BoundingBox[];
    underlineStyle?: UnderlineStyle;
}

export interface InkAnnotation extends BaseAnnotation {
    toolType: "freehand_write";
    strokeWidth: number;
    points: Point[];
}

export interface NoteAnnotation extends BaseAnnotation {
    toolType: "popup_note";
    comment: string;
    contextSnippet?: string;
}

export interface CropAnnotation extends BaseAnnotation {
    toolType: "area_select";
    imageUrl: string;
    caption?: string;
    width: number;
    height: number;
}

export type PdfAnnotation =
    | TextMarkupAnnotation
    | InkAnnotation
    | NoteAnnotation
    | CropAnnotation;

/** Annotations burned directly into the PDF binary (excludes figure crops). */
export type BurnableAnnotation = Exclude<PdfAnnotation, CropAnnotation>;

// Type guards for clean filtering in ViewerPage / PdfSidebar / PdfPage
export const isCropAnnotation = (a: PdfAnnotation): a is CropAnnotation =>
    a.toolType === "area_select";

export const isNoteAnnotation = (a: PdfAnnotation): a is NoteAnnotation =>
    a.toolType === "popup_note";

export const isInkAnnotation = (a: PdfAnnotation): a is InkAnnotation =>
    a.toolType === "freehand_write";

export const isTextMarkupAnnotation = (
    a: PdfAnnotation,
): a is TextMarkupAnnotation =>
    a.toolType === "highlight" ||
    a.toolType === "underline" ||
    a.toolType === "strikethrough";