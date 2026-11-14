/**
 * Foliet - Tool & Toolbar Preset Types
 */

export type ToolType =
    | "select"
    | "highlight"
    | "underline"
    | "strikethrough"
    | "popup_note"
    | "freehand_write"
    | "eraser"
    | "area_select";

export type UnderlineStyle = "solid" | "squiggle" | "dashed";

export interface ToolPreset {
    id: string;
    toolType: ToolType;
    label: string;
    shortcut: string;
    color: string;
    strokeWidth?: number;
    underlineStyle?: UnderlineStyle;
    isCustom?: boolean;
}

export interface ActiveToolState {
    toolType: ToolType;
    activePresetId: string | null;
    color: string;
    strokeWidth: number;
    underlineStyle: UnderlineStyle;
}

export const isUtilityTool = (type: ToolType): boolean =>
    type === "eraser" || type === "area_select";