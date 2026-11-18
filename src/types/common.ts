/**
 * Foliet - Shared Primitive, Geometry & Base Types
 */

export interface Point {
    x: number;
    y: number;
}

export interface Dimensions {
    width: number;
    height: number;
}

export interface Rect extends Point, Dimensions { }

export interface DocRef {
    docId: string;
    docTitle: string;
    filePath: string;
}

export interface ReadingPosition {
    lastPage: number;
    scrollOffset: number;
    zoom: number;
}

export interface ModelPreset<P extends string = string> {
    id: string;
    label: string;
    provider: P;
    description: string;
    isDefault?: boolean;
}