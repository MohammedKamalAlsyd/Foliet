/**
 * Foliet - SSE / NDJSON Stream Parsing & Error Helpers
 */

import { createParser } from "eventsource-parser";

async function readBodyChunks(
    response: Response,
    signal: AbortSignal | undefined,
    onChunk: (text: string) => void,
): Promise<void> {
    if (!response.body) {
        throw new Error("No response body received.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    try {
        while (true) {
            if (signal?.aborted) {
                await reader.cancel();
                throw new DOMException("The operation was aborted.", "AbortError");
            }
            const { done, value } = await reader.read();
            if (done) break;
            onChunk(decoder.decode(value, { stream: true }));
        }
        const tail = decoder.decode();
        if (tail) onChunk(tail);
    } finally {
        reader.releaseLock();
    }
}

export async function streamSse(
    response: Response,
    signal: AbortSignal | undefined,
    onData: (data: string) => void,
): Promise<void> {
    const parser = createParser({
        onEvent(event) {
            onData(event.data);
        },
    });
    await readBodyChunks(response, signal, (chunk) => parser.feed(chunk));
}

export async function streamNdjson(
    response: Response,
    signal: AbortSignal | undefined,
    onLine: (line: string) => void,
): Promise<void> {
    let buffer = "";
    await readBodyChunks(response, signal, (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) onLine(trimmed);
        }
    });
    const remaining = buffer.trim();
    if (remaining) onLine(remaining);
}

export async function parseErrorResponse(
    response: Response,
    providerName: string,
): Promise<string> {
    try {
        const errorJson = await response.json();
        const msg =
            errorJson?.error?.message ||
            errorJson?.message ||
            errorJson?.error ||
            (typeof errorJson === "string" ? errorJson : null);
        if (msg) return `[${providerName}] ${response.status}: ${msg}`;
    } catch {
        // Fall back to plain text
    }

    try {
        const text = await response.text();
        if (text) return `[${providerName}] ${response.status}: ${text.slice(0, 300)}`;
    } catch {
        // Ignore
    }

    return `[${providerName}] Request failed with status ${response.status} (${response.statusText})`;
}

export async function fetchWithToolFallback(
    sendReq: (includeTools: boolean) => Promise<Response>,
    hasTools: boolean,
    providerName: string,
): Promise<Response> {
    let response = await sendReq(hasTools);
    if (!response.ok && response.status === 400 && hasTools) {
        const errText = await response
            .clone()
            .text()
            .catch(() => "");
        if (/tool|function|support/i.test(errText)) {
            response = await sendReq(false);
        }
    }
    if (!response.ok) {
        throw new Error(await parseErrorResponse(response, providerName));
    }
    return response;
}