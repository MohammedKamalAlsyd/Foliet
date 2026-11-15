import { useState, useEffect, useCallback, useRef } from "react";
import { DEFAULT_SELECT_TOOL, DEFAULT_TOOL_PRESETS } from "@/constants/tools";
import { SettingsStorage } from "@/services/storage/settings";
import type { ActiveToolState, ToolPreset, UnderlineStyle } from "@/types/tools";

export function useToolManager() {
    const [presets, setPresets] = useState<ToolPreset[]>(DEFAULT_TOOL_PRESETS);
    const [activeState, setActiveState] = useState<ActiveToolState>(DEFAULT_SELECT_TOOL);

    const presetsRef = useRef(presets);
    presetsRef.current = presets;
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        let active = true;
        SettingsStorage.getToolPresets()
            .then((loaded) => {
                if (active && loaded.length > 0) setPresets(loaded);
            })
            .catch(() => { });
        return () => {
            active = false;
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                SettingsStorage.saveToolPresets(presetsRef.current).catch(() => { });
            }
        };
    }, []);

    const persistPresets = useCallback(async (next: ToolPreset[]) => {
        presetsRef.current = next;
        setPresets(next);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            SettingsStorage.saveToolPresets(next).catch(() => { });
        }, 250);
    }, []);

    const setSelectMode = useCallback(() => {
        setActiveState((prev) =>
            prev.toolType === "select" && prev.activePresetId === null
                ? prev
                : { ...prev, toolType: "select", activePresetId: null },
        );
    }, []);

    const togglePreset = useCallback((presetId: string) => {
        setActiveState((prev) => {
            if (prev.activePresetId === presetId) {
                return { ...prev, toolType: "select", activePresetId: null };
            }
            const target = presetsRef.current.find((p) => p.id === presetId);
            if (!target) return prev;
            return {
                toolType: target.toolType,
                activePresetId: target.id,
                color: target.color,
                strokeWidth: target.strokeWidth ?? 2,
                underlineStyle: target.underlineStyle ?? "solid",
            };
        });
    }, []);

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
            const match = presetsRef.current.find((p) => p.shortcut.toLowerCase() === key);
            if (match) {
                e.preventDefault();
                togglePreset(match.id);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [togglePreset, setSelectMode]);

    const addPreset = useCallback(
        (preset: Omit<ToolPreset, "id">) =>
            persistPresets([
                ...presetsRef.current,
                { ...preset, id: `custom-preset-${Date.now()}`, isCustom: true },
            ]),
        [persistPresets],
    );

    const updatePreset = useCallback(
        async (updated: ToolPreset) => {
            await persistPresets(
                presetsRef.current.map((p) => (p.id === updated.id ? updated : p)),
            );
            setActiveState((prev) =>
                prev.activePresetId === updated.id
                    ? {
                        ...prev,
                        toolType: updated.toolType,
                        color: updated.color,
                        strokeWidth: updated.strokeWidth ?? prev.strokeWidth,
                        underlineStyle: updated.underlineStyle ?? prev.underlineStyle,
                    }
                    : prev,
            );
        },
        [persistPresets],
    );

    const removePreset = useCallback(
        async (presetId: string) => {
            await persistPresets(presetsRef.current.filter((p) => p.id !== presetId));
            setActiveState((prev) =>
                prev.activePresetId === presetId
                    ? { ...prev, toolType: "select", activePresetId: null }
                    : prev,
            );
        },
        [persistPresets],
    );

    const resetPresets = useCallback(async () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        setPresets(await SettingsStorage.resetToolPresets());
        setSelectMode();
    }, [setSelectMode]);

    const setStrokeWidth = useCallback(
        (strokeWidth: number) => setActiveState((p) => ({ ...p, strokeWidth })),
        [],
    );

    const setUnderlineStyle = useCallback(
        (underlineStyle: UnderlineStyle) => setActiveState((p) => ({ ...p, underlineStyle })),
        [],
    );

    return {
        presets,
        activeState,
        togglePreset,
        setSelectMode,
        setStrokeWidth,
        setUnderlineStyle,
        addPreset,
        updatePreset,
        removePreset,
        resetPresets,
    };
}