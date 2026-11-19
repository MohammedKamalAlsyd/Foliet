import { DEFAULT_AI_SETTINGS, DEFAULT_RAG_HYPERPARAMETERS } from "@/constants/models";
import { DEFAULT_TOOL_PRESETS } from "@/constants/tools";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useSystemStore } from "@/stores/systemStore";
import { useToolStore } from "@/stores/toolStore";
import type { LlmProvider } from "@/types/chat";
import type { EmbeddingProvider, RagHyperparameters } from "@/types/embedding";
import type { ToolPreset } from "@/types/tools";

export interface UserPreferences {
    theme: "dark" | "light";
    defaultZoom: number;
    sidebarOpen: boolean;
}

export interface AiSettings {
    llmProvider: LlmProvider;
    llmModel: string;
    apiKeys: Partial<Record<LlmProvider, string>>;
    ollamaEndpoint: string;
    webSearchEnabled?: boolean;
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    embeddingApiKey: string;
    hyperparameters: RagHyperparameters;
}

export class SettingsStorage {
    public static async getPreferences(): Promise<UserPreferences> {
        const sys = useSystemStore.getState();
        return {
            theme: sys.theme,
            defaultZoom: sys.defaultZoom ?? 100,
            sidebarOpen: sys.sidebarOpen ?? true,
        };
    }

    public static async savePreferences(
        prefs: Partial<UserPreferences>,
    ): Promise<UserPreferences> {
        const sys = useSystemStore.getState();
        if (prefs.theme !== undefined) sys.setTheme(prefs.theme);
        if (prefs.sidebarOpen !== undefined) sys.setSidebarOpen(prefs.sidebarOpen);
        if (prefs.defaultZoom !== undefined) sys.setDefaultZoom(prefs.defaultZoom);
        return this.getPreferences();
    }

    public static async getTheme(): Promise<"dark" | "light"> {
        return useSystemStore.getState().theme;
    }

    public static async setTheme(theme: "dark" | "light"): Promise<void> {
        useSystemStore.getState().setTheme(theme);
    }

    public static async getToolPresets(): Promise<ToolPreset[]> {
        return useToolStore.getState().presets;
    }

    public static async saveToolPresets(presets: ToolPreset[]): Promise<void> {
        useToolStore.setState({ presets });
    }

    public static async resetToolPresets(): Promise<ToolPreset[]> {
        useToolStore.getState().resetPresets();
        return DEFAULT_TOOL_PRESETS;
    }

    public static async getAiSettings(): Promise<AiSettings> {
        const s = useAiConfigStore.getState();
        return {
            llmProvider: s.llmProvider,
            llmModel: s.llmModel,
            apiKeys: s.apiKeys,
            ollamaEndpoint: s.ollamaEndpoint,
            webSearchEnabled: s.webSearchEnabled,
            embeddingProvider: s.embeddingProvider,
            embeddingModel: s.embeddingModel,
            embeddingApiKey: s.embeddingApiKey,
            hyperparameters: s.hyperparameters,
        };
    }

    public static async saveAiSettings(
        patch: Partial<AiSettings>,
    ): Promise<AiSettings> {
        const store = useAiConfigStore.getState();
        const { apiKeys, embeddingApiKey, ...nonSecretPatch } = patch;

        if (Object.keys(nonSecretPatch).length > 0) {
            useAiConfigStore.setState(nonSecretPatch);
        }

        if (apiKeys) {
            for (const [provider, value] of Object.entries(apiKeys)) {
                if (typeof value === "string") {
                    await store.setApiKey(provider as LlmProvider, value);
                }
            }
        }

        if (embeddingApiKey !== undefined) {
            await store.setEmbeddingApiKey(embeddingApiKey);
        }

        return this.getAiSettings();
    }

    public static async resetAiSettings(): Promise<AiSettings> {
        await useAiConfigStore.getState().resetToDefaults();
        return {
            ...DEFAULT_AI_SETTINGS,
            apiKeys: {},
            hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },
        };
    }
}
