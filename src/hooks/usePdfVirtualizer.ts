import { useMemo } from "react";

export function usePdfVirtualizer(currentPage: number, totalPages: number, buffer = 3) {
    const start = Math.max(1, currentPage - buffer);
    const end = Math.min(Math.max(1, totalPages), currentPage + buffer);

    const renderedPages = useMemo(() => {
        const set = new Set<number>();
        for (let p = start; p <= end; p++) set.add(p);
        return set;
    }, [start, end]);

    return { renderedPages };
}