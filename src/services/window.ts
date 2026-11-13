import { getCurrentWindow, Window, type CloseRequestedEvent } from "@tauri-apps/api/window";

export class WindowService {
    // Lazy getter: Only evaluates when a function is actually called
    private static get appWindow(): Window | null {
        if (typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__)) {
            return getCurrentWindow();
        }
        return null;
    }

    public static async minimize(): Promise<void> {
        await this.appWindow?.minimize();
    }

    public static async toggleMaximize(): Promise<boolean> {
        if (!this.appWindow) return false;
        await this.appWindow.toggleMaximize();
        return await this.appWindow.isMaximized();
    }

    public static async isMaximized(): Promise<boolean> {
        if (!this.appWindow) return false;
        return await this.appWindow.isMaximized();
    }

    public static async close(): Promise<void> {
        await this.appWindow?.close();
    }

    public static async forceDestroy(): Promise<void> {
        await this.appWindow?.destroy();
    }

    public static async onCloseRequested(
        callback: (event: CloseRequestedEvent) => void,
    ): Promise<() => void> {
        if (!this.appWindow) return () => { };
        return await this.appWindow.onCloseRequested(callback);
    }

    public static async onMaximizeChange(
        callback: (isMax: boolean) => void,
    ): Promise<() => void> {
        if (!this.appWindow) return () => { };
        return await this.appWindow.onResized(async () => {
            const maximized = await this.appWindow!.isMaximized();
            callback(maximized);
        });
    }
}