import { create } from "zustand";
import { PlatformService, type PlatformOS } from "@/services/platform";
import { SettingsStorage } from "@/services/storage/settings";

export interface SystemState {
    platform: PlatformOS;
    theme: "dark" | "light";
    isMac: boolean;
    isWindows: boolean;
    isLinux: boolean;
    shortcutModifier: string;
    isDark: boolean;

    initSystem: () => Promise<void>;
    setTheme: (theme: "dark" | "light") => void;
    toggleTheme: () => void;
}

const applyThemeToDom = (theme: "dark" | "light") => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "dark") {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }
};

export const useSystemStore = create<SystemState>((set, get) => ({
    platform: "windows",
    theme: "dark",
    isMac: false,
    isWindows: true,
    isLinux: false,
    shortcutModifier: "Ctrl",
    isDark: true,

    initSystem: async () => {
        try {
            const [os, savedTheme] = await Promise.all([
                PlatformService.getPlatform().catch(() => "windows" as PlatformOS),
                SettingsStorage.getTheme().catch(() => "dark" as const),
            ]);

            applyThemeToDom(savedTheme);

            const isMac = os === "macos";
            set({
                platform: os,
                theme: savedTheme,
                isMac,
                isWindows: os === "windows",
                isLinux: os === "linux",
                shortcutModifier: isMac ? "⌘" : "Ctrl",
                isDark: savedTheme === "dark",
            });
        } catch (err) {
            console.warn("SystemStore: Failed to initialize system settings:", err);
        }
    },

    setTheme: (newTheme: "dark" | "light") => {
        applyThemeToDom(newTheme);
        SettingsStorage.setTheme(newTheme).catch((err) =>
            console.warn("SystemStore: Failed to persist theme:", err)
        );
        set({
            theme: newTheme,
            isDark: newTheme === "dark",
        });
    },

    toggleTheme: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        get().setTheme(next);
    },
}));

// Initialize OS detection and saved theme on startup
useSystemStore.getState().initSystem();