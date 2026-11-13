import { platform } from "@tauri-apps/plugin-os";

export type PlatformOS = "macos" | "windows" | "linux";

export class PlatformService {
    private static cachedOS: PlatformOS | null = null;

    public static async getPlatform(): Promise<PlatformOS> {
        if (this.cachedOS) return this.cachedOS;

        const current = await platform();
        if (current === "macos" || current === "windows" || current === "linux") {
            this.cachedOS = current;
            return current;
        }

        // Default fallback to linux if unrecognized POSIX
        this.cachedOS = "linux";
        return "linux";
    }

    public static isMacSync(): boolean {
        if (this.cachedOS) return this.cachedOS === "macos";
        return navigator.userAgent.toLowerCase().includes("mac");
    }

    public static getShortcutModifier(): string {
        return this.isMacSync() ? "⌘" : "Ctrl";
    }
}