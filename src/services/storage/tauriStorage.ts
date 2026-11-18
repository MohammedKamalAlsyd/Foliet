import { LazyStore } from "@tauri-apps/plugin-store";
import type { StateStorage } from "zustand/middleware";

export const settingsLazyStore = new LazyStore("settings.json");

export const tauriSettingsStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      const val = await settingsLazyStore.get<any>(name);
      if (val === null || val === undefined) return null;
      if (name === "tool_presets" && Array.isArray(val)) {
        return JSON.stringify({ state: { presets: val } });
      }
      if (typeof val === "object" && !("state" in val)) {
        return JSON.stringify({ state: val });
      }
      return typeof val === "string" ? val : JSON.stringify(val);
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const parsed = JSON.parse(value);
      const toSave =
        parsed && typeof parsed === "object" && "state" in parsed
          ? parsed.state
          : parsed;
      const finalData =
        name === "tool_presets" && toSave && typeof toSave === "object" && "presets" in toSave
          ? toSave.presets
          : toSave;
      await settingsLazyStore.set(name, finalData);
      await settingsLazyStore.save();
    } catch {
      await settingsLazyStore.set(name, value);
      await settingsLazyStore.save();
    }
  },
  removeItem: async (name: string): Promise<void> => {
    await settingsLazyStore.delete(name);
    await settingsLazyStore.save();
  },
};
