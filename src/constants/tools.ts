import { ToolPreset } from "@/types/tools";

export const DEFAULT_TOOL_PRESETS: ToolPreset[] = [
    {
        id: "preset-highlight-yellow",
        toolType: "highlight",
        label: "Yellow Highlight",
        shortcut: "1",
        color: "#EAB308",
    },
    {
        id: "preset-highlight-red",
        toolType: "highlight",
        label: "Red Highlight",
        shortcut: "2",
        color: "#DC2626",
    },
    {
        id: "preset-underline-green",
        toolType: "underline",
        label: "Green Underline",
        shortcut: "3",
        color: "#16A34A",
        underlineStyle: "solid",
    },
    {
        id: "preset-strike-red",
        toolType: "strikethrough",
        label: "Red Strike",
        shortcut: "4",
        color: "#DC2626",
    },
    {
        id: "preset-note-cyan",
        toolType: "popup_note",
        label: "Note",
        shortcut: "5",
        color: "#0284C7",
    },
    {
        id: "preset-pen-indigo",
        toolType: "freehand_write",
        label: "Pen",
        shortcut: "6",
        color: "#4F46E5",
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
        color: "#0284C7",
    },
];

export const DEFAULT_SELECT_TOOL = {
    toolType: "select" as const,
    activePresetId: null,
    color: "#EAB308",
    strokeWidth: 2,
    underlineStyle: "solid" as const,
};

export const PRESET_COLORS = [
    { name: "Yellow", hex: "#EAB308" },
    { name: "Orange", hex: "#C2410C" },
    { name: "Red", hex: "#DC2626" },
    { name: "Green", hex: "#16A34A" },
    { name: "Blue", hex: "#0284C7" },
    { name: "Indigo", hex: "#4F46E5" },
] as const;