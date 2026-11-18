import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_SELECT_TOOL, DEFAULT_TOOL_PRESETS } from "@/constants/tools";
import { tauriSettingsStorage } from "@/services/storage/tauriStorage";
import type { ActiveToolState, ToolPreset, UnderlineStyle } from "@/types/tools";

export interface ToolStoreState {
    presets: ToolPreset[];
    activeState: ActiveToolState;
    setSelectMode: () => void;
    togglePreset: (presetId: string) => void;
    setStrokeWidth: (strokeWidth: number) => void;
    setUnderlineStyle: (underlineStyle: UnderlineStyle) => void;
    addPreset: (preset: Omit<ToolPreset, "id">) => void;
    updatePreset: (updated: ToolPreset) => void;
    removePreset: (presetId: string) => void;
    resetPresets: () => void;
}

export const useToolStore = create<ToolStoreState>()(
    persist(
        (set, get) => ({
            presets: DEFAULT_TOOL_PRESETS,
            activeState: DEFAULT_SELECT_TOOL,

            setSelectMode: () =>
                set((state) =>
                    state.activeState.toolType === "select" && state.activeState.activePresetId === null
                        ? state
                        : { activeState: { ...state.activeState, toolType: "select", activePresetId: null } },
                ),

            togglePreset: (presetId: string) =>
                set((state) => {
                    if (state.activeState.activePresetId === presetId) {
                        return { activeState: { ...state.activeState, toolType: "select", activePresetId: null } };
                    }
                    const target = state.presets.find((p) => p.id === presetId);
                    if (!target) return state;
                    return {
                        activeState: {
                            toolType: target.toolType,
                            activePresetId: target.id,
                            color: target.color,
                            strokeWidth: target.strokeWidth ?? 2,
                            underlineStyle: target.underlineStyle ?? "solid",
                        },
                    };
                }),

            setStrokeWidth: (strokeWidth: number) =>
                set((state) => ({ activeState: { ...state.activeState, strokeWidth } })),

            setUnderlineStyle: (underlineStyle: UnderlineStyle) =>
                set((state) => ({ activeState: { ...state.activeState, underlineStyle } })),

            addPreset: (preset) =>
                set((state) => ({
                    presets: [
                        ...state.presets,
                        { ...preset, id: `custom-preset-${Date.now()}`, isCustom: true },
                    ],
                })),

            updatePreset: (updated) =>
                set((state) => ({
                    presets: state.presets.map((p) => (p.id === updated.id ? updated : p)),
                    activeState:
                        state.activeState.activePresetId === updated.id
                            ? {
                                ...state.activeState,
                                toolType: updated.toolType,
                                color: updated.color,
                                strokeWidth: updated.strokeWidth ?? state.activeState.strokeWidth,
                                underlineStyle: updated.underlineStyle ?? state.activeState.underlineStyle,
                            }
                            : state.activeState,
                })),

            removePreset: (presetId) =>
                set((state) => ({
                    presets: state.presets.filter((p) => p.id !== presetId),
                    activeState:
                        state.activeState.activePresetId === presetId
                            ? { ...state.activeState, toolType: "select", activePresetId: null }
                            : state.activeState,
                })),

            resetPresets: () => {
                set({ presets: DEFAULT_TOOL_PRESETS });
                get().setSelectMode();
            },
        }),
        {
            name: "tool_presets",
            storage: createJSONStorage(() => tauriSettingsStorage),
            partialize: (state) => ({ presets: state.presets }),
        },
    ),
);
