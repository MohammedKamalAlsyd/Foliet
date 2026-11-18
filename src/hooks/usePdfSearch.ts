import { useState, useRef, useCallback, useEffect } from "react";
import { useDebouncedCallback } from "use-debounce";
import { extractPdfPageText } from "@/utils/pdfDom";

export function usePdfSearch(
    pdfProxy: any,
    onJumpToPage: (page: number) => void,
) {
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<number[]>([]);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [isSearching, setIsSearching] = useState(false);

    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const cacheRef = useRef<Map<number, string>>(new Map());
    const runIdRef = useRef(0);

    const debouncedSearch = useDebouncedCallback(
        async (clean: string, runId: number) => {
            const matches: number[] = [];
            try {
                for (let p = 1; p <= pdfProxy.numPages; p++) {
                    if (runIdRef.current !== runId) return;

                    let pageText = cacheRef.current.get(p);
                    if (pageText === undefined) {
                        const extracted = await extractPdfPageText(pdfProxy, p);
                        pageText = extracted.toLowerCase();
                        cacheRef.current.set(p, pageText);
                    }

                    let pos = pageText.indexOf(clean);
                    while (pos !== -1) {
                        matches.push(p);
                        pos = pageText.indexOf(clean, pos + clean.length);
                    }
                }

                if (runIdRef.current !== runId) return;
                setSearchResults(matches);
                setCurrentMatchIndex(0);
                if (matches.length > 0) onJumpToPage(matches[0]);
            } catch (err) {
                console.warn("Search error:", err);
            } finally {
                if (runIdRef.current === runId) setIsSearching(false);
            }
        },
        160,
    );

    const cancelPending = useCallback(() => {
        debouncedSearch.cancel();
        runIdRef.current++;
    }, [debouncedSearch]);

    useEffect(() => {
        cancelPending();
        cacheRef.current.clear();
        setSearchResults([]);
        setCurrentMatchIndex(0);
        setIsSearching(false);
        return cancelPending;
    }, [pdfProxy, cancelPending]);

    const executeSearch = useCallback(
        (queryText: string) => {
            cancelPending();
            const clean = queryText.toLowerCase().trim();
            if (!pdfProxy || !clean) {
                setSearchResults([]);
                setCurrentMatchIndex(0);
                setIsSearching(false);
                return;
            }

            const runId = runIdRef.current;
            setIsSearching(true);
            debouncedSearch(clean, runId);
        },
        [pdfProxy, cancelPending, debouncedSearch],
    );

    const stepMatch = useCallback(
        (delta: number) => {
            if (searchResults.length === 0) return;
            const idx =
                (currentMatchIndex + delta + searchResults.length) %
                searchResults.length;
            setCurrentMatchIndex(idx);
            onJumpToPage(searchResults[idx]);
        },
        [searchResults, currentMatchIndex, onJumpToPage],
    );

    const handleSearchNext = useCallback(() => stepMatch(1), [stepMatch]);
    const handleSearchPrev = useCallback(() => stepMatch(-1), [stepMatch]);

    const openSearch = useCallback(() => {
        setIsSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }, []);

    const closeSearch = useCallback(() => {
        cancelPending();
        setIsSearchOpen(false);
        setIsSearching(false);
    }, [cancelPending]);

    return {
        isSearchOpen,
        searchQuery,
        setSearchQuery,
        searchResults,
        currentMatchIndex,
        isSearching,
        searchInputRef,
        executeSearch,
        handleSearchNext,
        handleSearchPrev,
        openSearch,
        closeSearch,
    };
}
