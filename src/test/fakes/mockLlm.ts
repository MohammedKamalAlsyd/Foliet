import type { StreamChatOptions } from "@/services/llm/types";

export interface ScriptedToolInvocation {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ScriptedLlmResponse {
  /** Chunks emitted before any tool calls */
  preChunks?: string[];
  /** Tool calls executed against `options.tools` */
  toolCalls?: ScriptedToolInvocation[];
  /** Chunks emitted after tool calls complete */
  chunks?: string[];
  /** Optional artificial delay between chunks (ms) */
  chunkDelayMs?: number;
  /** Optional custom handler for full manual/deferred streaming control */
  customHandler?: (options: StreamChatOptions) => Promise<string>;
}

export interface DeferredStreamController {
  pushChunk: (chunk: string) => void;
  finish: () => void;
  fail: (err: Error) => void;
  started: Promise<StreamChatOptions>;
}

class MockLlmController {
  public calls: StreamChatOptions[] = [];
  private queue: ScriptedLlmResponse[] = [];
  private defaultHandler: (options: StreamChatOptions) => Promise<string>;

  constructor() {
    this.defaultHandler = async (options) => {
      const reply = "Mock Lio response.";
      options.onChunk(reply);
      return reply;
    };
  }

  public reset(): void {
    this.calls = [];
    this.queue = [];
    this.defaultHandler = async (options) => {
      const reply = "Mock Lio response.";
      options.onChunk(reply);
      return reply;
    };
  }

  public enqueueResponse(response: ScriptedLlmResponse): void {
    this.queue.push(response);
  }

  public setDefaultHandler(
    handler: (options: StreamChatOptions) => Promise<string>,
  ): void {
    this.defaultHandler = handler;
  }

  /**
   * Enqueues a manually controlled stream so tests can push chunks one by one
   * and click the real Stop button mid-stream to verify `AbortSignal` handling.
   */
  public enqueueDeferredStream(): DeferredStreamController {
    let resolveStarted!: (opts: StreamChatOptions) => void;
    const started = new Promise<StreamChatOptions>((resolve) => {
      resolveStarted = resolve;
    });

    let activeOptions: StreamChatOptions | null = null;
    let accumulated = "";
    let resolveStream!: (val: string) => void;
    let rejectStream!: (err: unknown) => void;
    let settled = false;

    const finishSafe = () => {
      if (settled) return;
      settled = true;
      resolveStream(accumulated);
    };

    const failSafe = (err: unknown) => {
      if (settled) return;
      settled = true;
      rejectStream(err);
    };

    this.enqueueResponse({
      customHandler: (options) => {
        activeOptions = options;
        resolveStarted(options);

        return new Promise<string>((resolve, reject) => {
          resolveStream = resolve;
          rejectStream = reject;

          const onAbort = () => {
            failSafe(new DOMException("Aborted", "AbortError"));
          };
          if (options.signal?.aborted) {
            onAbort();
            return;
          }
          options.signal?.addEventListener("abort", onAbort, { once: true });
        });
      },
    });

    return {
      started,
      pushChunk: (chunk: string) => {
        if (settled || !activeOptions) return;
        accumulated += chunk;
        activeOptions.onChunk(chunk);
      },
      finish: finishSafe,
      fail: failSafe,
    };
  }

  public async streamChat(options: StreamChatOptions): Promise<string> {
    this.calls.push(options);

    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const scripted = this.queue.shift();
    if (!scripted) {
      return this.defaultHandler(options);
    }

    if (scripted.customHandler) {
      return scripted.customHandler(options);
    }

    let accumulated = "";
    const emitChunks = async (chunks: string[] | undefined) => {
      for (const chunk of chunks ?? []) {
        if (options.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        accumulated += chunk;
        options.onChunk(chunk);
        if (scripted.chunkDelayMs && scripted.chunkDelayMs > 0) {
          await new Promise((r) => setTimeout(r, scripted.chunkDelayMs));
        }
      }
    };

    await emitChunks(scripted.preChunks);

    if (scripted.toolCalls && options.tools) {
      for (let i = 0; i < scripted.toolCalls.length; i++) {
        if (options.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        const call = scripted.toolCalls[i];
        const toolDef = options.tools[call.name] as
          | {
              execute?: (
                args: Record<string, unknown>,
                ctx: { toolCallId: string; messages: unknown[] },
              ) => Promise<unknown>;
            }
          | undefined;
        if (toolDef?.execute) {
          await toolDef.execute(call.arguments, {
            toolCallId: call.id ?? `tool-call-${i + 1}`,
            messages: [],
          });
        }
      }
    }

    await emitChunks(scripted.chunks);
    return accumulated;
  }
}

export const mockLlm = new MockLlmController();
