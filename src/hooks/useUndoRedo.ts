import { useState, useCallback, useMemo } from "react";

interface HistoryState<T> {
    past: { value: T; rev: number }[];
    present: T;
    rev: number;
    maxRev: number;
    future: { value: T; rev: number }[];
    savedRev: number;
    savedValue: T;
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }

    if (typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
        const objA = a as Record<string, unknown>;
        const objB = b as Record<string, unknown>;
        const keysA = Object.keys(objA);
        const keysB = Object.keys(objB);
        if (keysA.length !== keysB.length) return false;
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
            if (!deepEqual(objA[key], objB[key])) return false;
        }
        return true;
    }

    return false;
}

export function useUndoRedo<T>(
    initialPresent: T,
    maxDepth = 50,
    isEqual: (a: T, b: T) => boolean = deepEqual,
) {
    const [history, setHistory] = useState<HistoryState<T>>({
        past: [],
        present: initialPresent,
        rev: 0,
        maxRev: 0,
        future: [],
        savedRev: 0,
        savedValue: initialPresent,
    });

    const set = useCallback(
        (nextState: T | ((prev: T) => T)) => {
            setHistory((curr) => {
                const resolved =
                    typeof nextState === "function"
                        ? (nextState as (prev: T) => T)(curr.present)
                        : nextState;
                if (resolved === curr.present || isEqual(resolved, curr.present)) {
                    return curr;
                }

                const nextRev = curr.maxRev + 1;
                const nextPast = [...curr.past, { value: curr.present, rev: curr.rev }];
                return {
                    ...curr,
                    past:
                        nextPast.length > maxDepth
                            ? nextPast.slice(nextPast.length - maxDepth)
                            : nextPast,
                    present: resolved,
                    rev: nextRev,
                    maxRev: nextRev,
                    future: [],
                };
            });
        },
        [maxDepth, isEqual],
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
                savedValue: newState,
            };
        });
    }, []);

    const markSaved = useCallback(() => {
        setHistory((curr) =>
            curr.savedRev === curr.rev && curr.savedValue === curr.present
                ? curr
                : { ...curr, savedRev: curr.rev, savedValue: curr.present },
        );
    }, []);

    const isDirty = useMemo(() => {
        if (history.rev === history.savedRev) return false;
        return !isEqual(history.present, history.savedValue);
    }, [history.rev, history.savedRev, history.present, history.savedValue, isEqual]);

    return {
        state: history.present,
        set,
        undo,
        redo,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        reset,
        isDirty,
        markSaved,
    };
}