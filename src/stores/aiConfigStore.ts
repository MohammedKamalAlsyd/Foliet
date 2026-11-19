/**
 * Foliet - AI Configuration Store
 *
 * Non-secret preferences persist via `tauriSettingsStorage` (`settings.json`).
 * API keys (`apiKeys`, `embeddingApiKey`) live strictly in memory on the JS side
 * and are persisted exclusively in the Rust AES-256-GCM encrypted store (`secrets.enc`).
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
    DEFAULT_AI_SETTINGS,
    DEFAULT_RAG_HYPERPARAMETERS,
    EMBEDDING_PRESETS,
    LLM_PRESETS,
} from "@/constants/models";
import {
    EMBEDDING_SECRET_SLOT,
    deleteApiSecret,
    loadApiSecrets,
    saveApiSecret,
} from "@/services/secrets";
import { DocumentDatabase } from "@/services/storage/database";
import {
    settingsLazyStore,
    tauriSettingsStorage,
} from "@/services/storage/tauriStorage";
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
    secretsHydrated: boolean;
    initializeConfig: () => Promise<void>;
    hydrateSecrets: () => Promise<void>;
    setLlmProvider: (provider: LlmProvider) => Promise<void>;
    setLlmModel: (model: string) => Promise<void>;
    setApiKey: (provider: LlmProvider, key: string) => Promise<void>;
    clearApiKey: (provider: LlmProvider) => Promise<void>;
    setOllamaEndpoint: (endpoint: string) => Promise<void>;
    setWebSearchEnabled: (enabled: boolean) => Promise<void>;
    setEmbeddingProvider: (provider: EmbeddingProvider) => Promise<void>;
    setEmbeddingModel: (model: string) => Promise<void>;
    setEmbeddingApiKey: (key: string) => Promise<void>;
    clearEmbeddingApiKey: () => Promise<void>;
    setHyperparameters: (patch: Partial<RagHyperparameters>) => Promise<void>;
    resetToDefaults: () => Promise<void>;
    getActiveEmbeddingConfig: () => EmbeddingConfig;
    getActiveLlmConfig: () => ActiveLlmConfig;
}

const LLM_PROVIDERS: readonly LlmProvider[] = [
    "openrouter",
    "google-ai-studio",
    "ollama",
    "openai",
    "anthropic",
] as const;

const DEFAULT_API_KEYS: Record<LlmProvider, string> = {
    openrouter: "",
    "google-ai-studio": "",
    ollama: "",
    openai: "",
    anthropic: "",
};

const LEGACY_LOCAL_STORAGE_KEYS = [
    "ai_settings",
    "foliet_ai_settings",
    "foliet-ai-settings",
    "foliet-ai-config",
] as const;

// Per-slot coalescing write queue so rapid typing never blocks UI or races disk writes.
const pendingSlotValues = new Map<string, string>();
const inFlightSlotWrites = new Map<string, Promise<void>>();

function persistSecretSlot(slot: string, value: string): Promise<void> {
    pendingSlotValues.set(slot, value);

    const existing = inFlightSlotWrites.get(slot);
    if (existing) {
        return existing;
    }

    const runner = (async () => {
        try {
            while (pendingSlotValues.has(slot)) {
                const nextValue = pendingSlotValues.get(slot)!;
                pendingSlotValues.delete(slot);
                if (nextValue.trim().length === 0) {
                    await deleteApiSecret(slot);
                } else {
                    await saveApiSecret(slot, nextValue);
                }
            }
        } catch (err) {
            console.warn(
                `AiConfigStore: Failed to persist encrypted secret for slot "${slot}":`,
                err instanceof Error ? err.message : "unknown error",
            );
        } finally {
            inFlightSlotWrites.delete(slot);
        }
    })();

    inFlightSlotWrites.set(slot, runner);
    return runner;
}

interface ExtractedLegacySecrets {
    apiKeys: Record<string, string>;
    embeddingApiKey: string;
    hasSecretFields: boolean;
}

function extractSecretsFromRecord(raw: unknown): ExtractedLegacySecrets {
    const result: ExtractedLegacySecrets = {
        apiKeys: {},
        embeddingApiKey: "",
        hasSecretFields: false,
    };
    if (!raw || typeof raw !== "object") return result;

    const root = raw as Record<string, unknown>;
    const target =
        "state" in root && root.state && typeof root.state === "object"
            ? (root.state as Record<string, unknown>)
            : root;

    if ("apiKeys" in target) {
        result.hasSecretFields = true;
        if (target.apiKeys && typeof target.apiKeys === "object") {
            for (const [provider, value] of Object.entries(
                target.apiKeys as Record<string, unknown>,
            )) {
                if (typeof value === "string" && value.trim().length > 0) {
                    result.apiKeys[provider] = value;
                }
            }
        }
    }

    if ("embeddingApiKey" in target) {
        result.hasSecretFields = true;
        if (
            typeof target.embeddingApiKey === "string" &&
            target.embeddingApiKey.trim().length > 0
        ) {
            result.embeddingApiKey = target.embeddingApiKey;
        }
    }

    return result;
}

function stripSecretsFromObject(raw: Record<string, unknown>): Record<string, unknown> {
    const clone: Record<string, unknown> = structuredClone(raw);
    const target =
        "state" in clone && clone.state && typeof clone.state === "object"
            ? (clone.state as Record<string, unknown>)
            : clone;
    delete target.apiKeys;
    delete target.embeddingApiKey;
    return clone;
}

function isLlmProvider(value: string): value is LlmProvider {
    return (LLM_PROVIDERS as readonly string[]).includes(value);
}

async function migrateAndScrubLegacySecrets(): Promise<void> {
    const discoveredApiKeys: Record<string, string> = {};
    let discoveredEmbeddingKey = "";

    const localStorageToScrub: Array<{
        key: string;
        parsed: Record<string, unknown>;
    }> = [];
    let settingsStoreRecordToScrub: Record<string, unknown> | null = null;

    // 1. Inspect legacy localStorage entries
    if (typeof localStorage !== "undefined") {
        for (const storageKey of LEGACY_LOCAL_STORAGE_KEYS) {
            try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object") continue;

                const extracted = extractSecretsFromRecord(parsed);
                if (!extracted.hasSecretFields) continue;

                for (const [provider, val] of Object.entries(extracted.apiKeys)) {
                    discoveredApiKeys[provider] = val;
                }
                if (extracted.embeddingApiKey) {
                    discoveredEmbeddingKey = extracted.embeddingApiKey;
                }
                localStorageToScrub.push({
                    key: storageKey,
                    parsed: parsed as Record<string, unknown>,
                });
            } catch {
                // Ignore malformed legacy entries
            }
        }
    }

    // 2. Inspect legacy plaintext keys in Tauri settings.json (`ai_settings`)
    try {
        const stored = await settingsLazyStore.get<unknown>("ai_settings");
        if (stored && typeof stored === "object") {
            const extracted = extractSecretsFromRecord(stored);
            if (extracted.hasSecretFields) {
                for (const [provider, val] of Object.entries(extracted.apiKeys)) {
                    if (!discoveredApiKeys[provider]) {
                        discoveredApiKeys[provider] = val;
                    }
                }
                if (!discoveredEmbeddingKey && extracted.embeddingApiKey) {
                    discoveredEmbeddingKey = extracted.embeddingApiKey;
                }
                settingsStoreRecordToScrub = stored as Record<string, unknown>;
            }
        }
    } catch {
        // Ignore if plugin-store is unavailable
    }

    // 3. Inspect legacy plaintext keys in SQLite (if any legacy settings table exists)
    try {
        const sqliteLegacy = await DocumentDatabase.consumeLegacyApiSecrets();
        for (const [provider, val] of Object.entries(sqliteLegacy.apiKeys)) {
            if (!discoveredApiKeys[provider]) {
                discoveredApiKeys[provider] = val;
            }
        }
        if (!discoveredEmbeddingKey && sqliteLegacy.embeddingApiKey) {
            discoveredEmbeddingKey = sqliteLegacy.embeddingApiKey;
        }
    } catch {
        // Safe no-op
    }

    // 4. Encrypt & persist any discovered legacy secrets in Rust BEFORE scrubbing plaintext
    for (const [provider, value] of Object.entries(discoveredApiKeys)) {
        if (value.trim().length > 0) {
            await saveApiSecret(provider, value);
        }
    }
    if (discoveredEmbeddingKey.trim().length > 0) {
        await saveApiSecret(EMBEDDING_SECRET_SLOT, discoveredEmbeddingKey);
    }

    // 5. Scrub plaintext secrets from localStorage
    if (typeof localStorage !== "undefined") {
        for (const { key, parsed } of localStorageToScrub) {
            try {
                const cleaned = stripSecretsFromObject(parsed);
                const inner =
                    "state" in cleaned && cleaned.state && typeof cleaned.state === "object"
                        ? (cleaned.state as Record<string, unknown>)
                        : cleaned;
                if (Object.keys(inner).length === 0) {
                    localStorage.removeItem(key);
                } else {
                    localStorage.setItem(key, JSON.stringify(cleaned));
                }
            } catch {
                try {
                    localStorage.removeItem(key);
                } catch {
                    // Ignore storage errors
                }
            }
        }
    }

    // 6. Scrub plaintext secrets from settings.json (`settingsLazyStore`)
    if (settingsStoreRecordToScrub) {
        try {
            const cleaned = stripSecretsFromObject(settingsStoreRecordToScrub);
            await settingsLazyStore.set("ai_settings", cleaned);
            await settingsLazyStore.save();
        } catch {
            // Ignore plugin-store write errors
        }
    }
}

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
            secretsHydrated: false,

            getActiveEmbeddingConfig: () => {
                const s = get();
                return {
                    provider: s.embeddingProvider,
                    model: s.embeddingModel,
                    apiKey: s.embeddingApiKey || undefined,
                    endpoint:
                        s.embeddingProvider === "ollama" ? s.ollamaEndpoint : undefined,
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
                await get().hydrateSecrets();
            },

            hydrateSecrets: async () => {
                try {
                    await migrateAndScrubLegacySecrets();
                    const payload = await loadApiSecrets();

                    const mergedKeys: Record<LlmProvider, string> = {
                        ...DEFAULT_API_KEYS,
                    };
                    for (const [provider, key] of Object.entries(payload.apiKeys ?? {})) {
                        if (isLlmProvider(provider) && typeof key === "string") {
                            mergedKeys[provider] = key;
                        }
                    }

                    set({
                        apiKeys: mergedKeys,
                        embeddingApiKey:
                            typeof payload.embeddingApiKey === "string"
                                ? payload.embeddingApiKey
                                : "",
                        secretsHydrated: true,
                    });
                } catch (err) {
                    console.warn(
                        "AiConfigStore: Failed to hydrate encrypted API secrets:",
                        err instanceof Error ? err.message : "unknown error",
                    );
                    set({ secretsHydrated: true });
                }
            },

            setLlmProvider: async (provider) => {
                const presets = LLM_PRESETS[provider];
                const llmModel =
                    presets?.find((p) => p.isDefault)?.id ??
                    presets?.[0]?.id ??
                    get().llmModel;
                set({ llmProvider: provider, llmModel });
            },

            setLlmModel: async (llmModel) => {
                set({ llmModel });
            },

            setApiKey: async (provider, key) => {
                set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: key } }));
                await persistSecretSlot(provider, key);
            },

            clearApiKey: async (provider) => {
                await get().setApiKey(provider, "");
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
                await persistSecretSlot(EMBEDDING_SECRET_SLOT, embeddingApiKey);
            },

            clearEmbeddingApiKey: async () => {
                await get().setEmbeddingApiKey("");
            },

            setHyperparameters: async (patch) => {
                set((state) => ({
                    hyperparameters: { ...state.hyperparameters, ...patch },
                }));
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

                await Promise.all([
                    ...LLM_PROVIDERS.map((provider) => persistSecretSlot(provider, "")),
                    persistSecretSlot(EMBEDDING_SECRET_SLOT, ""),
                ]);
            },
        }),
        {
            name: "ai_settings",
            storage: createJSONStorage(() => tauriSettingsStorage),
            partialize: (state) => ({
                llmProvider: state.llmProvider,
                llmModel: state.llmModel,
                ollamaEndpoint: state.ollamaEndpoint,
                webSearchEnabled: state.webSearchEnabled,
                embeddingProvider: state.embeddingProvider,
                embeddingModel: state.embeddingModel,
                hyperparameters: state.hyperparameters,
            }),
            merge: (persistedState, currentState) => {
                if (!persistedState || typeof persistedState !== "object") {
                    return currentState;
                }
                const safe = { ...(persistedState as Record<string, unknown>) };
                // Never hydrate API keys from plaintext settings storage
                delete safe.apiKeys;
                delete safe.embeddingApiKey;
                delete safe.secretsHydrated;
                return {
                    ...currentState,
                    ...(safe as Partial<AiConfigStore>),
                };
            },
        },
    ),
);
