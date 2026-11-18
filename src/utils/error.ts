export function extractErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === "string" && err.trim()) return err;
    if (err instanceof Error && err.message.trim()) return err.message;
    if (typeof err === "object" && err !== null && "message" in err) {
        const msg = String((err as { message?: unknown }).message ?? "").trim();
        if (msg) return msg;
    }
    return fallback;
}

export function isAbortError(err: unknown, signal?: AbortSignal): boolean {
    return (
        Boolean(signal?.aborted) ||
        (err instanceof Error && err.name === "AbortError") ||
        (typeof err === "object" &&
            err !== null &&
            (err as { name?: unknown }).name === "AbortError")
    );
}