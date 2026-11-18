/**
 * Foliet - LLM Streaming Service
 *
 * Public facade over provider adapters (`src/services/llm/*`) and prompt
 * builders (`src/utils/llmPrompts.ts`).
 */

import { SettingsStorage, type AiSettings } from "@/services/storage/settings";
import {
    buildChapterSummaryPrompt,
    buildModifySummaryPrompt,
    buildRagSystemPrompt,
    buildStructuredSummarizationPrompt,
    buildSummarySystemPrompt,
} from "@/utils/llmPrompts";
import {
    dispatchProviderStream,
    isVisionCapableModel,
    PROVIDER_NAMES,
} from "./llm/providers";
import { FOLIET_TOOL_DEFINITIONS } from "./llm/tools";
import type { StreamChatOptions } from "./llm/types";

export type * from "./llm/types";
export { FOLIET_TOOL_DEFINITIONS, isVisionCapableModel };

export class LlmService {
    public static async streamChat(options: StreamChatOptions): Promise<string> {
        const aiSettings = await SettingsStorage.getAiSettings();
        const provider = options.provider ?? aiSettings.llmProvider;
        const model = options.model ?? aiSettings.llmModel;
        const apiKey = options.apiKey ?? aiSettings.apiKeys[provider] ?? "";
        const ollamaEndpoint =
            options.ollamaEndpoint ??
            aiSettings.ollamaEndpoint ??
            "http://localhost:11434";
        const webSearchEnabled =
            options.webSearchEnabled ??
            Boolean(
                (aiSettings as AiSettings & { webSearchEnabled?: boolean })
                    .webSearchEnabled,
            );

        if (provider !== "ollama" && !apiKey.trim()) {
            const providerName = PROVIDER_NAMES[provider] || provider;
            throw new Error(
                `API key for ${providerName} is not configured. Please add your API key in Settings.`,
            );
        }

        return dispatchProviderStream({
            provider,
            model,
            apiKey,
            ollamaEndpoint,
            options: { ...options, webSearchEnabled },
        });
    }

    public static buildRagSystemPrompt = buildRagSystemPrompt;
    public static buildSummarySystemPrompt = buildSummarySystemPrompt;
    public static buildChapterSummaryPrompt = buildChapterSummaryPrompt;
    public static buildModifySummaryPrompt = buildModifySummaryPrompt;
    public static buildStructuredSummarizationPrompt =
        buildStructuredSummarizationPrompt;
}

export const streamChat = LlmService.streamChat.bind(LlmService);
export { buildRagSystemPrompt, buildStructuredSummarizationPrompt };