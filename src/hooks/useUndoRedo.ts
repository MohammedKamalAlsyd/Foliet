import { useState, useCallback, useRef } from "react";

interface HistoryState<T> {
    past: { value: T; rev: number }[];
    present: T;
    rev: number;
    future: { value: T; rev: number }[];
}

export function useUndoRedo<T>(initialPresent: T, maxDepth = 50) {
    const [history, setHistory] = useState<HistoryState<T>>({
        past: [],
        present: initialPresent,
        rev: 0,
        future: [],
    });
    const [savedRev, setSavedRev] = useState(0);
    const nextRevRef = useRef(1);

    const set = useCallback(
        (nextState: T | ((prev: T) => T)) => {
            setHistory((curr) => {
                const resolved =
                    typeof nextState === "function"
                        ? (nextState as (prev: T) => T)(curr.present)
                        : nextState;
                if (resolved === curr.present) return curr;

                const nextPast = [...curr.past, { value: curr.present, rev: curr.rev }];
                return {
                    past: nextPast.length > maxDepth ? nextPast.slice(nextPast.length - maxDepth) : nextPast,
                    present: resolved,
                    rev: nextRevRef.current++,
                    future: [],
                };
            });
        },
        [maxDepth],
    );

    const undo = useCallback(() => {
        setHistory((curr) => {
            if (curr.past.length === 0) return curr;
            const prev = curr.past[curr.past.length - 1];
            return {
                past: curr.past.slice(0, -1),
                present: prev.value,
                rev: prev.rev,
                future: [{ value: curr.present, rev: curr.rev }, ...curr.future],
            };
        });
    }, []);

    const redo = useCallback(() => {
        setHistory((curr) => {
            if (curr.future.length === 0) return curr;
            const [next, ...rest] = curr.future;
            return {
                past: [...curr.past, { value: curr.present, rev: curr.rev }],
                present: next.value,
                rev: next.rev,
                future: rest,
            };
        });
    }, []);

    const reset = useCallback((newState: T) => {
        const rev = nextRevRef.current++;
        setHistory({ past: [], present: newState, rev, future: [] });
        setSavedRev(rev);
    }, []);

    const markSaved = useCallback(() => {
        setHistory((curr) => {
            setSavedRev(curr.rev);
            return curr;
        });
    }, []);

    return {
        state: history.present,
        set,
        undo,
        redo,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        reset,
        isDirty: history.rev !== savedRev,
        markSaved,
    };
}