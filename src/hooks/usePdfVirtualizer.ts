import { useMemo } from "react";

export function usePdfVirtualizer(
    currentPage: number,
    totalPages: number,
    buffer = 2,
) {
    const safeTotal = Math.max(1, totalPages);
    const start = Math.max(1, currentPage - buffer);
    const end = Math.min(safeTotal, currentPage + buffer);

    const renderedPages = useMemo(() => {
        const set = new Set<number>();
        for (let p = start; p <= end; p++) set.add(p);
        return set;
    }, [start, end]);

    return { renderedPages };
}