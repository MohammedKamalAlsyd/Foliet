import { useEffect } from "react";
import { tinykeys } from "tinykeys";
import { useToolStore } from "@/stores/toolStore";

export function useToolManager() {
    const store = useToolStore();

    useEffect(() => {
        const keymap: Record<string, (e: KeyboardEvent) => void> = {
            Escape: () => store.setSelectMode(),
            v: () => store.setSelectMode(),
            V: () => store.setSelectMode(),
        };

        for (const preset of store.presets) {
            if (preset.shortcut) {
                const sc = preset.shortcut.toLowerCase();
                const handler = (e: KeyboardEvent) => {
                    e.preventDefault();
                    store.togglePreset(preset.id);
                };
                keymap[sc] = handler;
                keymap[sc.toUpperCase()] = handler;
            }
        }

        return tinykeys(window, keymap);
    }, [store.presets, store.setSelectMode, store.togglePreset]);

    return store;
}
