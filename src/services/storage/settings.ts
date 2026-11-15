import { LazyStore } from "@tauri-apps/plugin-store";
import { ToolPreset } from "@/types/tools";
import { DEFAULT_TOOL_PRESETS } from "@/constants/tools";
import { DEFAULT_RAG_HYPERPARAMETERS, DEFAULT_AI_SETTINGS } from "@/constants/models";
import type { LlmProvider } from "@/types/chat";
import type { EmbeddingProvider, RagHyperparameters } from "@/types/embedding";

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
    embeddingProvider: EmbeddingProvider;
    embeddingModel: string;
    embeddingApiKey: string;
    hyperparameters: RagHyperparameters;
}

const DEFAULT_PREFERENCES: UserPreferences = {
    theme: "light",
    defaultZoom: 100,
    sidebarOpen: true,
};

export class SettingsStorage {
    private static store = new LazyStore("settings.json");

    // =========================================================================
    // User Preferences
    // =========================================================================

    public static async getPreferences(): Promise<UserPreferences> {
        try {
            const prefs = await this.store.get<Partial<UserPreferences>>(
                "user_preferences"
            );
            if (prefs) {
                return { ...DEFAULT_PREFERENCES, ...prefs };
            }
        } catch (err) {
            console.warn("SettingsStorage: Error reading preferences:", err);
        }
        return { ...DEFAULT_PREFERENCES };
    }

    public static async savePreferences(
        prefs: Partial<UserPreferences>
    ): Promise<UserPreferences> {
        const current = await this.getPreferences();
        const next = { ...current, ...prefs };
        await this.store.set("user_preferences", next);
        await this.store.save();
        return next;
    }

    public static async resetPreferences(): Promise<UserPreferences> {
        const defaults = { ...DEFAULT_PREFERENCES };
        await this.store.set("user_preferences", defaults);
        await this.store.save();
        return defaults;
    }

    public static async getTheme(): Promise<"dark" | "light"> {
        const prefs = await this.getPreferences();
        return prefs.theme === "light" ? "light" : "dark";
    }

    public static async setTheme(theme: "dark" | "light"): Promise<void> {
        await this.savePreferences({ theme });
    }

    // =========================================================================
    // Tool Presets
    // =========================================================================

    public static async getToolPresets(): Promise<ToolPreset[]> {
        try {
            const saved = await this.store.get<ToolPreset[]>("tool_presets");
            if (Array.isArray(saved) && saved.length > 0) {
                return saved;
            }
        } catch (err) {
            console.warn("SettingsStorage: Failed to read tool presets:", err);
        }
        return DEFAULT_TOOL_PRESETS;
    }

    public static async saveToolPresets(presets: ToolPreset[]): Promise<void> {
        await this.store.set("tool_presets", presets);
        await this.store.save();
    }

    public static async resetToolPresets(): Promise<ToolPreset[]> {
        await this.saveToolPresets(DEFAULT_TOOL_PRESETS);
        return DEFAULT_TOOL_PRESETS;
    }

    // =========================================================================
    // AI & Embedding Settings
    // =========================================================================

    public static async getAiSettings(): Promise<AiSettings> {
        try {
            const saved = await this.store.get<Partial<AiSettings>>("ai_settings");
            if (saved) {
                return {
                    ...DEFAULT_AI_SETTINGS,
                    ...saved,
                    apiKeys: {
                        ...DEFAULT_AI_SETTINGS.apiKeys,
                        ...saved.apiKeys,
                    },
                    hyperparameters: {
                        ...DEFAULT_AI_SETTINGS.hyperparameters,
                        ...saved.hyperparameters,
                    },
                };
            }
        } catch (err) {
            console.warn("SettingsStorage: Failed to read AI settings:", err);
        }
        return {
            ...DEFAULT_AI_SETTINGS,
            apiKeys: {},
            hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },
        };
    }

    public static async saveAiSettings(
        patch: Partial<AiSettings>
    ): Promise<AiSettings> {
        const current = await this.getAiSettings();
        const next: AiSettings = {
            ...current,
            ...patch,
            apiKeys: patch.apiKeys
                ? { ...current.apiKeys, ...patch.apiKeys }
                : current.apiKeys,
            hyperparameters: patch.hyperparameters
                ? { ...current.hyperparameters, ...patch.hyperparameters }
                : current.hyperparameters,
        };
        await this.store.set("ai_settings", next);
        await this.store.save();
        return next;
    }

    public static async resetAiSettings(): Promise<AiSettings> {
        const defaults: AiSettings = {
            ...DEFAULT_AI_SETTINGS,
            apiKeys: {},
            hyperparameters: { ...DEFAULT_RAG_HYPERPARAMETERS },
        };
        await this.store.set("ai_settings", defaults);
        await this.store.save();
        return defaults;
    }
}