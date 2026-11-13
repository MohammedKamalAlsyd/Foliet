import { LazyStore } from "@tauri-apps/plugin-store";
import { ToolPreset } from "@/types/tools";
import { DEFAULT_TOOL_PRESETS } from "@/constants/tools";

export interface UserPreferences {
    theme: "dark" | "light";
    defaultZoom: number;
    sidebarOpen: boolean;
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
}