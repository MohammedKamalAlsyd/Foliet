import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { PlatformService, type PlatformOS } from "@/services/platform";
import { tauriSettingsStorage } from "@/services/storage/tauriStorage";

export interface SystemState {
    platform: PlatformOS;
    theme: "dark" | "light";
    defaultZoom: number;
    sidebarOpen: boolean;
    isMac: boolean;
    isWindows: boolean;
    isLinux: boolean;
    shortcutModifier: string;
    isDark: boolean;

    initSystem: () => Promise<void>;
    setTheme: (theme: "dark" | "light") => void;
    toggleTheme: () => void;
    setSidebarOpen: (open: boolean) => void;
    toggleSidebar: () => void;
    setDefaultZoom: (zoom: number) => void;
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

export const useSystemStore = create<SystemState>()(
    persist(
        (set, get) => ({
            platform: "windows",
            theme: "dark",
            defaultZoom: 100,
            sidebarOpen: true,
            isMac: false,
            isWindows: true,
            isLinux: false,
            shortcutModifier: "Ctrl",
            isDark: true,

            initSystem: async () => {
                try {
                    const os = await PlatformService.getPlatform().catch(
                        () => "windows" as PlatformOS,
                    );
                    const isMac = os === "macos";
                    const currentTheme = get().theme;
                    applyThemeToDom(currentTheme);

                    set({
                        platform: os,
                        isMac,
                        isWindows: os === "windows",
                        isLinux: os === "linux",
                        shortcutModifier: isMac ? "⌘" : "Ctrl",
                        isDark: currentTheme === "dark",
                    });
                } catch (err) {
                    console.warn("SystemStore: Failed to initialize system settings:", err);
                }
            },

            setTheme: (newTheme: "dark" | "light") => {
                applyThemeToDom(newTheme);
                set({
                    theme: newTheme,
                    isDark: newTheme === "dark",
                });
            },

            toggleTheme: () => {
                const next = get().theme === "dark" ? "light" : "dark";
                get().setTheme(next);
            },

            setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

            toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

            setDefaultZoom: (zoom: number) => set({ defaultZoom: zoom }),
        }),
        {
            name: "user_preferences",
            storage: createJSONStorage(() => tauriSettingsStorage),
            partialize: (state) => ({
                theme: state.theme,
                defaultZoom: state.defaultZoom,
                sidebarOpen: state.sidebarOpen,
            }),
            onRehydrateStorage: () => (state) => {
                if (state?.theme) {
                    applyThemeToDom(state.theme);
                }
            },
        },
    ),
);

// Initialize OS detection and saved theme on startup
void useSystemStore.getState().initSystem();
