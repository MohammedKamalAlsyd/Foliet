import { useState, useCallback } from "react";

interface HistoryState<T> {
    past: { value: T; rev: number }[];
    present: T;
    rev: number;
    maxRev: number;
    future: { value: T; rev: number }[];
    savedRev: number;
}

export function useUndoRedo<T>(initialPresent: T, maxDepth = 50) {
    const [history, setHistory] = useState<HistoryState<T>>({
        past: [],
        present: initialPresent,
        rev: 0,
        maxRev: 0,
        future: [],
        savedRev: 0,
    });

    const set = useCallback(
        (nextState: T | ((prev: T) => T)) => {
            setHistory((curr) => {
                const resolved =
                    typeof nextState === "function"
                        ? (nextState as (prev: T) => T)(curr.present)
                        : nextState;
                if (Object.is(resolved, curr.present)) return curr;

                const nextRev = curr.maxRev + 1;
                const nextPast =
                    curr.past.length >= maxDepth
                        ? [
                            ...curr.past.slice(curr.past.length - maxDepth + 1),
                            { value: curr.present, rev: curr.rev },
                        ]
                        : [...curr.past, { value: curr.present, rev: curr.rev }];

                return {
                    ...curr,
                    past: nextPast,
                    present: resolved,
                    rev: nextRev,
                    maxRev: nextRev,
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
                ...curr,
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
                ...curr,
                past: [...curr.past, { value: curr.present, rev: curr.rev }],
                present: next.value,
                rev: next.rev,
                future: rest,
            };
        });
    }, []);

    const reset = useCallback((newState: T) => {
        setHistory((curr) => {
            const rev = curr.maxRev + 1;
            return {
                past: [],
                present: newState,
                rev,
                maxRev: rev,
                future: [],
                savedRev: rev,
            };
        });
    }, []);

    const markSaved = useCallback(() => {
        setHistory((curr) =>
            curr.savedRev === curr.rev ? curr : { ...curr, savedRev: curr.rev },
        );
    }, []);

    return {
        state: history.present,
        set,
        undo,
        redo,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        reset,
        isDirty: history.rev !== history.savedRev,
        markSaved,
    };
}