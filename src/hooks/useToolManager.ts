import { useState, useEffect, useCallback } from "react";
import { DEFAULT_SELECT_TOOL, DEFAULT_TOOL_PRESETS } from "@/constants/tools";
import { SettingsStorage } from "@/services/storage/settings";
import type { ActiveToolState, ToolPreset, UnderlineStyle } from "@/types/tools";

export function useToolManager() {
    const [presets, setPresets] = useState<ToolPreset[]>(DEFAULT_TOOL_PRESETS);
    const [activeState, setActiveState] = useState<ActiveToolState>(DEFAULT_SELECT_TOOL);

    useEffect(() => {
        let active = true;
        SettingsStorage.getToolPresets()
            .then((loaded) => {
                if (active && loaded.length > 0) setPresets(loaded);
            })
            .catch(() => { });
        return () => {
            active = false;
        };
    }, []);

    const persistPresets = useCallback(async (next: ToolPreset[]) => {
        setPresets(next);
        await SettingsStorage.saveToolPresets(next);
    }, []);

    const setSelectMode = useCallback(() => {
        setActiveState((prev) => ({
            ...prev,
            toolType: "select",
            activePresetId: null,
        }));
    }, []);

    const togglePreset = useCallback(
        (presetId: string) => {
            setActiveState((prev) => {
                if (prev.activePresetId === presetId) {
                    return { ...prev, toolType: "select", activePresetId: null };
                }
                const target = presets.find((p) => p.id === presetId);
                if (!target) return prev;
                return {
                    toolType: target.toolType,
                    activePresetId: target.id,
                    color: target.color,
                    strokeWidth: target.strokeWidth ?? 2,
                    underlineStyle: target.underlineStyle ?? "solid",
                };
            });
        },
        [presets],
    );

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const el = document.activeElement as HTMLElement | null;
            if (
                el?.tagName === "INPUT" ||
                el?.tagName === "TEXTAREA" ||
                el?.isContentEditable ||
                e.ctrlKey ||
                e.metaKey ||
                e.altKey
            ) {
                return;
            }

            const key = e.key.toLowerCase();
            if (key === "escape" || key === "v") {
                setSelectMode();
                return;
            }
            const match = presets.find((p) => p.shortcut.toLowerCase() === key);
            if (match) {
                e.preventDefault();
                togglePreset(match.id);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [presets, togglePreset, setSelectMode]);

    const addPreset = useCallback(
        async (preset: Omit<ToolPreset, "id">) => {
            const next: ToolPreset = {
                ...preset,
                id: `custom-preset-${Date.now()}`,
                isCustom: true,
            };
            await persistPresets([...presets, next]);
        },
        [presets, persistPresets],
    );

    const updatePreset = useCallback(
        async (updated: ToolPreset) => {
            const next = presets.map((p) => (p.id === updated.id ? updated : p));
            await persistPresets(next);
            setActiveState((prev) =>
                prev.activePresetId === updated.id
                    ? {
                        ...prev,
                        color: updated.color,
                        strokeWidth: updated.strokeWidth ?? prev.strokeWidth,
                        underlineStyle: updated.underlineStyle ?? prev.underlineStyle,
                    }
                    : prev,
            );
        },
        [presets, persistPresets],
    );

    const removePreset = useCallback(
        async (presetId: string) => {
            await persistPresets(presets.filter((p) => p.id !== presetId));
            if (activeState.activePresetId === presetId) setSelectMode();
        },
        [presets, activeState.activePresetId, persistPresets, setSelectMode],
    );

    const resetPresets = useCallback(async () => {
        setPresets(await SettingsStorage.resetToolPresets());
        setSelectMode();
    }, [setSelectMode]);

    return {
        presets,
        activeState,
        togglePreset,
        setSelectMode,
        setStrokeWidth: useCallback(
            (strokeWidth: number) => setActiveState((p) => ({ ...p, strokeWidth })),
            [],
        ),
        setUnderlineStyle: useCallback(
            (underlineStyle: UnderlineStyle) => setActiveState((p) => ({ ...p, underlineStyle })),
            [],
        ),
        addPreset,
        updatePreset,
        removePreset,
        resetPresets,
    };
}