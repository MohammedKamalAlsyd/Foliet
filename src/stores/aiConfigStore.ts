/**
 * Foliet - Persisted AI Configuration Store
 *
 * Manages LLM provider/model/credentials, embedding provider/model/key,
 * and RAG hyperparameters backed by SettingsStorage.
 */

import { create } from "zustand";
import { SettingsStorage, type AiSettings } from "@/services/storage/settings";
import {
    DEFAULT_AI_SETTINGS,
    DEFAULT_RAG_HYPERPARAMETERS,
    EMBEDDING_PRESETS,
    LLM_PRESETS,
} from "@/constants/models";
import type { AiConfigState, LlmProvider } from "@/types/chat";
import type {
    EmbeddingConfig,
    EmbeddingProvider,
    RagHyperparameters,
} from "@/types/embedding";

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
}

const DEFAULT_API_KEYS: Record<LlmProvider, string> = {
    openrouter: "",
    "google-ai-studio": "",
    ollama: "",
    openai: "",
    anthropic: "",
};

let initPromise: Promise<void> | null = null;

export const useAiConfigStore = create<AiConfigStore>((set, get) => ({
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

    initializeConfig: () => {
        if (!initPromise) {
            initPromise = (async () => {
                try {
                    const saved = await SettingsStorage.getAiSettings();
                    const mergedKeys: Record<LlmProvider, string> = {
                        openrouter: saved.apiKeys.openrouter ?? "",
                        "google-ai-studio": saved.apiKeys["google-ai-studio"] ?? "",
                        ollama: saved.apiKeys.ollama ?? "",
                        openai: saved.apiKeys.openai ?? "",
                        anthropic: saved.apiKeys.anthropic ?? "",
                    };

                    set({
                        llmProvider: saved.llmProvider,
                        llmModel: saved.llmModel,
                        apiKeys: mergedKeys,
                        ollamaEndpoint: saved.ollamaEndpoint,
                        webSearchEnabled: Boolean(
                            (saved as AiSettings & { webSearchEnabled?: boolean }).webSearchEnabled
                        ),
                        embeddingProvider: saved.embeddingProvider,
                        embeddingModel: saved.embeddingModel,
                        embeddingApiKey: saved.embeddingApiKey,
                        hyperparameters: { ...saved.hyperparameters },
                    });
                } catch (err) {
                    console.warn("AiConfigStore: Failed to initialize settings:", err);
                }
            })();
        }
        return initPromise;
    },

    setLlmProvider: async (provider) => {
        const presets = LLM_PRESETS[provider];
        const defaultModel =
            presets?.find((p) => p.isDefault)?.id ?? presets?.[0]?.id ?? get().llmModel;
        set({
            llmProvider: provider,
            llmModel: defaultModel,
        });
        await SettingsStorage.saveAiSettings({
            llmProvider: provider,
            llmModel: defaultModel,
        });
    },

    setLlmModel: async (model) => {
        set({ llmModel: model });
        await SettingsStorage.saveAiSettings({ llmModel: model });
    },

    setApiKey: async (provider, key) => {
        const nextKeys = { ...get().apiKeys, [provider]: key };
        set({ apiKeys: nextKeys });
        await SettingsStorage.saveAiSettings({ apiKeys: nextKeys });
    },

    setOllamaEndpoint: async (endpoint) => {
        set({ ollamaEndpoint: endpoint });
        await SettingsStorage.saveAiSettings({ ollamaEndpoint: endpoint });
    },

    setWebSearchEnabled: async (enabled) => {
        set({ webSearchEnabled: enabled });
        await SettingsStorage.saveAiSettings({
            webSearchEnabled: enabled,
        } as Partial<AiSettings>);
    },

    setEmbeddingProvider: async (provider) => {
        const presets = EMBEDDING_PRESETS[provider];
        const preset = presets?.find((p) => p.isDefault) ?? presets?.[0];
        const defaultModel = preset?.id ?? get().embeddingModel;
        const nextHyper = preset
            ? { ...get().hyperparameters, vectorDimension: preset.dimensions }
            : get().hyperparameters;

        set({
            embeddingProvider: provider,
            embeddingModel: defaultModel,
            hyperparameters: nextHyper,
        });
        await SettingsStorage.saveAiSettings({
            embeddingProvider: provider,
            embeddingModel: defaultModel,
            hyperparameters: nextHyper,
        });
    },

    setEmbeddingModel: async (model) => {
        const provider = get().embeddingProvider;
        const preset = EMBEDDING_PRESETS[provider]?.find((p) => p.id === model);
        const nextHyper = preset
            ? { ...get().hyperparameters, vectorDimension: preset.dimensions }
            : get().hyperparameters;

        set({
            embeddingModel: model,
            hyperparameters: nextHyper,
        });
        await SettingsStorage.saveAiSettings({
            embeddingModel: model,
            hyperparameters: nextHyper,
        });
    },

    setEmbeddingApiKey: async (key) => {
        set({ embeddingApiKey: key });
        await SettingsStorage.saveAiSettings({ embeddingApiKey: key });
    },

    setHyperparameters: async (patch) => {
        const next = { ...get().hyperparameters, ...patch };
        set({ hyperparameters: next });
        await SettingsStorage.saveAiSettings({ hyperparameters: next });
    },

    resetToDefaults: async () => {
        const defaults = await SettingsStorage.resetAiSettings();
        set({
            llmProvider: defaults.llmProvider,
            llmModel: defaults.llmModel,
            apiKeys: { ...DEFAULT_API_KEYS },
            ollamaEndpoint: defaults.ollamaEndpoint,
            webSearchEnabled: false,
            embeddingProvider: defaults.embeddingProvider,
            embeddingModel: defaults.embeddingModel,
            embeddingApiKey: defaults.embeddingApiKey,
            hyperparameters: { ...defaults.hyperparameters },
        });
    },
}));

void useAiConfigStore.getState().initializeConfig();
