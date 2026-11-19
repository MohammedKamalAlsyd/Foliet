import type { Rect } from "@/types/common";

export function mergeLineRects(rects: Rect[]): Rect[] {
    if (rects.length <= 1) return rects;
    const sorted = [...rects].sort((a, b) =>
        Math.abs(a.y - b.y) > 0.004 ? a.y - b.y : a.x - b.x,
    );
    const merged: Rect[] = [];
    for (const r of sorted) {
        const target = merged.find((m) => {
            const overlapY =
                Math.min(m.y + m.height, r.y + r.height) - Math.max(m.y, r.y);
            const minH = Math.min(m.height, r.height);
            const sameLine = minH > 0 && overlapY / minH > 0.5;
            const horizontalTouch =
                r.x <= m.x + m.width + 0.008 && m.x <= r.x + r.width + 0.008;
            return sameLine && horizontalTouch;
        });
        if (target) {
            const minX = Math.min(target.x, r.x);
            const minY = Math.min(target.y, r.y);
            const maxX = Math.max(target.x + target.width, r.x + r.width);
            const maxY = Math.max(target.y + target.height, r.y + r.height);
            target.x = minX;
            target.y = minY;
            target.width = maxX - minX;
            target.height = maxY - minY;
        } else {
            merged.push({ ...r });
        }
    }
    return merged;
}