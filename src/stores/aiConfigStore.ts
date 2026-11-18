/**
 * Foliet - Persisted AI Configuration Store
 */

import { create } from "zustand";
import {
    DEFAULT_AI_SETTINGS,
    DEFAULT_RAG_HYPERPARAMETERS,
    EMBEDDING_PRESETS,
    LLM_PRESETS,
} from "@/constants/models";
import { SettingsStorage, type AiSettings } from "@/services/storage/settings";
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

let initPromise: Promise<void> | null = null;

export const useAiConfigStore = create<AiConfigStore>((set, get) => {
    const patchAndSave = async (patch: Partial<AiConfigState>) => {
        set(patch);
        await SettingsStorage.saveAiSettings(patch as Partial<AiSettings>);
    };

    return {
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

        initializeConfig: () => {
            if (!initPromise) {
                initPromise = (async () => {
                    try {
                        const saved = await SettingsStorage.getAiSettings();
                        set({
                            llmProvider: saved.llmProvider,
                            llmModel: saved.llmModel,
                            apiKeys: { ...DEFAULT_API_KEYS, ...saved.apiKeys },
                            ollamaEndpoint: saved.ollamaEndpoint,
                            webSearchEnabled: Boolean(
                                (saved as AiSettings & { webSearchEnabled?: boolean })
                                    .webSearchEnabled,
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
            const llmModel =
                presets?.find((p) => p.isDefault)?.id ?? presets?.[0]?.id ?? get().llmModel;
            await patchAndSave({ llmProvider: provider, llmModel });
        },

        setLlmModel: (llmModel) => patchAndSave({ llmModel }),
        setApiKey: (provider, key) =>
            patchAndSave({ apiKeys: { ...get().apiKeys, [provider]: key } }),
        setOllamaEndpoint: (ollamaEndpoint) => patchAndSave({ ollamaEndpoint }),
        setWebSearchEnabled: (webSearchEnabled) => patchAndSave({ webSearchEnabled }),

        setEmbeddingProvider: async (provider) => {
            const presets = EMBEDDING_PRESETS[provider];
            const preset = presets?.find((p) => p.isDefault) ?? presets?.[0];
            const embeddingModel = preset?.id ?? get().embeddingModel;
            const hyperparameters = preset
                ? { ...get().hyperparameters, vectorDimension: preset.dimensions }
                : get().hyperparameters;
            await patchAndSave({
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
            await patchAndSave({ embeddingModel, hyperparameters });
        },

        setEmbeddingApiKey: (embeddingApiKey) => patchAndSave({ embeddingApiKey }),
        setHyperparameters: (patch) =>
            patchAndSave({ hyperparameters: { ...get().hyperparameters, ...patch } }),

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
    };
});

void useAiConfigStore.getState().initializeConfig();