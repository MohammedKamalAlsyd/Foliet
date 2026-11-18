/**
 * Foliet - Persisted AI Configuration Store
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
    DEFAULT_AI_SETTINGS,
    DEFAULT_RAG_HYPERPARAMETERS,
    EMBEDDING_PRESETS,
    LLM_PRESETS,
} from "@/constants/models";
import { tauriSettingsStorage } from "@/services/storage/tauriStorage";
import type { AiConfigState, LlmProvider } from "@/types/chat";
import type {
    EmbeddingConfig,
    EmbeddingProvider,
    RagHyperparameters,
} from "@/types/embedding";

export interface ActiveLlmConfig {
    provider: LlmProvider;
    model: string;
    apiKey: string;
    ollamaEndpoint: string;
}

export interface AiConfigStore extends AiConfigState {
    initializeConfig: () => Promise<void>;
    setLlmProvider: (provider: LlmProvider) => Promise<void>;
    setLlmModel: (model: string) => Promise<void>;
    setApiKey: (provider: LlmProvider, key: string) => Promise<void>;
    setOllamaEndpoint: (endpoint: string) => Promise<void>;
    setWebSearchEnabled: (enabled: boolean) => Promise<void>;
    setEmbeddingProvider: (provider: EmbeddingProvider) => Promise<void>;
    setEmbeddingModel: (model: string) => Promise<void>;
    setEmbeddingApiKey: (key: string) => Promise<void>;
    setHyperparameters: (patch: Partial<RagHyperparameters>) => Promise<void>;
    resetToDefaults: () => Promise<void>;
    getActiveEmbeddingConfig: () => EmbeddingConfig;
    getActiveLlmConfig: () => ActiveLlmConfig;
}

const DEFAULT_API_KEYS: Record<LlmProvider, string> = {
    openrouter: "",
    "google-ai-studio": "",
    ollama: "",
    openai: "",
    anthropic: "",
};

export const useAiConfigStore = create<AiConfigStore>()(
    persist(
        (set, get) => ({
            llmProvider: DEFAULT_AI_SETTINGS.llmProvider,
            llmModel: DEFAULT_AI_SETTINGS.llmModel,
            apiKeys: { ...DEFAULT_API_KEYS },
            ollamaEndpoint: DEFAULT_AI_SETTINGS.ollamaEndpoint,
            webSearchEnabled: DEFAULT_AI_SETTINGS.webSearchEnabled,
            embeddingProvider: DEFAULT_AI_SETTINGS.embeddingProvider,
            embeddingModel: DEFAULT_AI_SETTINGS.embeddingModel,
            embeddingApiKey: DEFAULT_AI_SETTINGS.embeddingApiKey,
            hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },

            getActiveEmbeddingConfig: () => {
                const s = get();
                return {
                    provider: s.embeddingProvider,
                    model: s.embeddingModel,
                    apiKey: s.embeddingApiKey || undefined,
                    endpoint: s.embeddingProvider === "ollama" ? s.ollamaEndpoint : undefined,
                };
            },

            getActiveLlmConfig: () => {
                const s = get();
                return {
                    provider: s.llmProvider,
                    model: s.llmModel,
                    apiKey: s.apiKeys[s.llmProvider] ?? "",
                    ollamaEndpoint: s.ollamaEndpoint,
                };
            },

            initializeConfig: async () => {
                // Handled automatically by Zustand persist rehydration
            },

            setLlmProvider: async (provider) => {
                const presets = LLM_PRESETS[provider];
                const llmModel =
                    presets?.find((p) => p.isDefault)?.id ?? presets?.[0]?.id ?? get().llmModel;
                set({ llmProvider: provider, llmModel });
            },

            setLlmModel: async (llmModel) => {
                set({ llmModel });
            },

            setApiKey: async (provider, key) => {
                set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } }));
            },

            setOllamaEndpoint: async (ollamaEndpoint) => {
                set({ ollamaEndpoint });
            },

            setWebSearchEnabled: async (webSearchEnabled) => {
                set({ webSearchEnabled });
            },

            setEmbeddingProvider: async (provider) => {
                const presets = EMBEDDING_PRESETS[provider];
                const preset = presets?.find((p) => p.isDefault) ?? presets?.[0];
                const embeddingModel = preset?.id ?? get().embeddingModel;
                const hyperparameters = preset
                    ? { ...get().hyperparameters, vectorDimension: preset.dimensions }
                    : get().hyperparameters;
                set({
                    embeddingProvider: provider,
                    embeddingModel,
                    hyperparameters,
                });
            },

            setEmbeddingModel: async (embeddingModel) => {
                const preset = EMBEDDING_PRESETS[get().embeddingProvider]?.find(
                    (p) => p.id === embeddingModel,
                );
                const hyperparameters = preset
                    ? { ...get().hyperparameters, vectorDimension: preset.dimensions }
                    : get().hyperparameters;
                set({ embeddingModel, hyperparameters });
            },

            setEmbeddingApiKey: async (embeddingApiKey) => {
                set({ embeddingApiKey });
            },

            setHyperparameters: async (patch) => {
                set((state) => ({ hyperparameters: { ...state.hyperparameters, ...patch } }));
            },

            resetToDefaults: async () => {
                set({
                    llmProvider: DEFAULT_AI_SETTINGS.llmProvider,
                    llmModel: DEFAULT_AI_SETTINGS.llmModel,
                    apiKeys: { ...DEFAULT_API_KEYS },
                    ollamaEndpoint: DEFAULT_AI_SETTINGS.ollamaEndpoint,
                    webSearchEnabled: false,
                    embeddingProvider: DEFAULT_AI_SETTINGS.embeddingProvider,
                    embeddingModel: DEFAULT_AI_SETTINGS.embeddingModel,
                    embeddingApiKey: DEFAULT_AI_SETTINGS.embeddingApiKey,
                    hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },
                });
            },
        }),
        {
            name: "ai_settings",
            storage: createJSONStorage(() => tauriSettingsStorage),
            partialize: (state) => ({
                llmProvider: state.llmProvider,
                llmModel: state.llmModel,
                apiKeys: state.apiKeys,
                ollamaEndpoint: state.ollamaEndpoint,
                webSearchEnabled: state.webSearchEnabled,
                embeddingProvider: state.embeddingProvider,
                embeddingModel: state.embeddingModel,
                embeddingApiKey: state.embeddingApiKey,
                hyperparameters: state.hyperparameters,
            }),
        },
    ),
);
