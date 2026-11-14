import { useState, useRef, useCallback, useEffect } from "react";

export interface SearchMatch {
    pageNumber: number;
}

export function usePdfSearch(pdfProxy: any, onJumpToPage: (page: number) => void) {
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [isSearching, setIsSearching] = useState(false);

    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const cacheRef = useRef<Map<number, string>>(new Map());
    const runIdRef = useRef(0);

    useEffect(() => {
        cacheRef.current.clear();
        setSearchResults([]);
        setCurrentMatchIndex(0);
    }, [pdfProxy]);

    const executeSearch = useCallback(
        async (queryText: string) => {
            const runId = ++runIdRef.current;
            const clean = queryText.toLowerCase().trim();
            if (!pdfProxy || !clean) {
                setSearchResults([]);
                setCurrentMatchIndex(0);
                setIsSearching(false);
                return;
            }

            setIsSearching(true);
            const matches: SearchMatch[] = [];

            try {
                for (let p = 1; p <= pdfProxy.numPages; p++) {
                    if (runIdRef.current !== runId) return;

                    let pageText = cacheRef.current.get(p);
                    if (pageText === undefined) {
                        const page = await pdfProxy.getPage(p);
                        const content = await page.getTextContent();
                        pageText = content.items.map((i: any) => i.str || "").join(" ").toLowerCase();
                        cacheRef.current.set(p, pageText);
                    }

                    let pos = pageText.indexOf(clean);
                    while (pos !== -1) {
                        matches.push({ pageNumber: p });
                        pos = pageText.indexOf(clean, pos + clean.length);
                    }
                }

                if (runIdRef.current !== runId) return;
                setSearchResults(matches);
                setCurrentMatchIndex(0);
                if (matches.length > 0) onJumpToPage(matches[0].pageNumber);
            } catch (err) {
                console.warn("Search error:", err);
            } finally {
                if (runIdRef.current === runId) setIsSearching(false);
            }
        },
        [pdfProxy, onJumpToPage],
    );

    const stepMatch = useCallback(
        (delta: number) => {
            if (searchResults.length === 0) return;
            const idx = (currentMatchIndex + delta + searchResults.length) % searchResults.length;
            setCurrentMatchIndex(idx);
            onJumpToPage(searchResults[idx].pageNumber);
        },
        [searchResults, currentMatchIndex, onJumpToPage],
    );

    const openSearch = useCallback(() => {
        setIsSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }, []);

    const closeSearch = useCallback(() => {
        runIdRef.current++;
        setIsSearchOpen(false);
        setIsSearching(false);
    }, []);

    return {
        isSearchOpen,
        searchQuery,
        setSearchQuery,
        searchResults,
        currentMatchIndex,
        isSearching,
        searchInputRef,
        executeSearch,
        handleSearchNext: () => stepMatch(1),
        handleSearchPrev: () => stepMatch(-1),
        openSearch,
        closeSearch,
    };
}