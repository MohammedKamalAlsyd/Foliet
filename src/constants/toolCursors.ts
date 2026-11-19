import type { ToolType } from "@/types/tools";

const svgCursor = (svg: string, x: number, y: number, fallback: string) =>
    `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fallback}`;

export function getToolCursor(tool: ToolType, color: string): string | undefined {
    switch (tool) {
        case "freehand_write":
            return svgCursor(
                `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' fill='white' stroke='#18181b' stroke-width='1.6' stroke-linejoin='round'/><path d='m14 6 4 4' stroke='${color}' stroke-width='2.4'/></svg>`,
                2,
                21,
                "crosshair",
            );
        case "highlight":
            return svgCursor(
                `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='m9 11-6 6v3h3l6-6' fill='${color}' fill-opacity='0.9' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/><path d='m20 7-5-5-8 8 5 5 8-8Z' fill='white' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/></svg>`,
                3,
                20,
                "text",
            );
        case "underline":
            return svgCursor(
                `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M9 4h6M9 17h6M12 4v13' stroke='#18181b' stroke-width='1.7' stroke-linecap='round'/><path d='M5 20.5h14' stroke='${color}' stroke-width='2.6' stroke-linecap='round'/></svg>`,
                12,
                11,
                "text",
            );
        case "strikethrough":
            return svgCursor(
                `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M9 4h6M9 20h6M12 4v16' stroke='#18181b' stroke-width='1.7' stroke-linecap='round'/><path d='M4 12h16' stroke='${color}' stroke-width='2.6' stroke-linecap='round'/></svg>`,
                12,
                12,
                "text",
            );
        case "popup_note":
            return svgCursor(
                `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5Z' fill='${color}' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/><path d='M8 8h8M8 12h5' stroke='white' stroke-width='1.5' stroke-linecap='round'/></svg>`,
                4,
                20,
                "cell",
            );
        case "eraser":
            return svgCursor(
                `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21H7Z' fill='white' stroke='#18181b' stroke-width='1.5' stroke-linejoin='round'/><path d='m5.5 11.5 7 7' stroke='#dc2626' stroke-width='1.5'/><path d='M3 21h18' stroke='#18181b' stroke-width='1.5' stroke-linecap='round'/></svg>`,
                5,
                19,
                "pointer",
            );
        case "area_select":
            return svgCursor(
                `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'><path d='M12 4v16M4 12h16' stroke='#18181b' stroke-width='1.6' stroke-linecap='round'/><circle cx='12' cy='12' r='2.2' fill='${color}' stroke='#18181b' stroke-width='1.2'/></svg>`,
                12,
                12,
                "crosshair",
            );
        default:
            return undefined;
    }
}