import { ToolPreset } from "@/types/tools";

export const DEFAULT_TOOL_PRESETS: ToolPreset[] = [
    {
        id: "preset-highlight-yellow",
        toolType: "highlight",
        label: "Yellow Highlight",
        shortcut: "1",
        color: "#FACC15",
    },
    {
        id: "preset-highlight-red",
        toolType: "highlight",
        label: "Red Highlight",
        shortcut: "2",
        color: "#EF4444",
    },
    {
        id: "preset-underline-green",
        toolType: "underline",
        label: "Green Underline",
        shortcut: "3",
        color: "#10B981",
        underlineStyle: "solid",
    },
    {
        id: "preset-strike-red",
        toolType: "strikethrough",
        label: "Red Strike",
        shortcut: "4",
        color: "#EF4444",
    },
    {
        id: "preset-note-cyan",
        toolType: "popup_note",
        label: "Note",
        shortcut: "5",
        color: "#06B6D4",
    },
    {
        id: "preset-pen-indigo",
        toolType: "freehand_write",
        label: "Pen",
        shortcut: "6",
        color: "#635BFF",
        strokeWidth: 2,
    },
    {
        id: "utility-eraser",
        toolType: "eraser",
        label: "Eraser",
        shortcut: "e",
        color: "#8A8F9E",
    },
    {
        id: "utility-crop",
        toolType: "area_select",
        label: "Crop",
        shortcut: "a",
        color: "#06B6D4",
    },
];

export const DEFAULT_SELECT_TOOL = {
    toolType: "select" as const,
    activePresetId: null,
    color: "#FACC15",
    strokeWidth: 2,
    underlineStyle: "solid" as const,
};