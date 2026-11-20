import {
  check,
  type CheckOptions,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateDownloadPhase = "started" | "progress" | "finished";

export interface UpdateDownloadProgress {
  phase: UpdateDownloadPhase;
  downloadedBytes: number;
  contentLength?: number;
  percent: number | null;
}

export interface CheckUpdateResult {
  update: Update | null;
  error?: string;
}

/**
 * Checks the configured Tauri updater endpoints for a newer release.
 * When `silent` is true (e.g. startup background check), network/offline errors
 * are swallowed cleanly and `{ update: null }` is returned.
 */
export async function checkForUpdates(
  options: { silent?: boolean; checkOptions?: CheckOptions } = {},
): Promise<CheckUpdateResult> {
  const { silent = false, checkOptions } = options;
  try {
    const update = await check(checkOptions);
    return { update };
  } catch (err) {
    if (silent) {
      return { update: null };
    }
    const rawMessage =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unable to check for updates right now.";
    const message = /valid release json/i.test(rawMessage)
      ? "No published update manifest (latest.json) found on GitHub Releases yet. Publish a public GitHub release with latest.json to enable auto-updates."
      : rawMessage;
    return { update: null, error: message };
  }
}

/**
 * Downloads and installs an available update while reporting granular progress
 * across Tauri's `Started`, `Progress`, and `Finished` download events.
 */
export async function downloadAndInstallUpdate(
  update: Update,
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<void> {
  let contentLength: number | undefined;
  let downloadedBytes = 0;

  await update.downloadAndInstall((event: DownloadEvent) => {
    switch (event.event) {
      case "Started": {
        contentLength = event.data.contentLength;
        downloadedBytes = 0;
        onProgress?.({
          phase: "started",
          downloadedBytes: 0,
          contentLength,
          percent: contentLength && contentLength > 0 ? 0 : null,
        });
        break;
      }
      case "Progress": {
        downloadedBytes += event.data.chunkLength;
        const percent =
          contentLength && contentLength > 0
            ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
            : null;
        onProgress?.({
          phase: "progress",
          downloadedBytes,
          contentLength,
          percent,
        });
        break;
      }
      case "Finished": {
        onProgress?.({
          phase: "finished",
          downloadedBytes,
          contentLength,
          percent: 100,
        });
        break;
      }
    }
  });
}

/**
 * Safely closes an unused Update handle to free native backend resources.
 */
export async function dismissUpdateHandle(update: Update | null): Promise<void> {
  if (!update) return;
  try {
    await update.close();
  } catch {
    // Ignore cleanup errors if the resource was already released
  }
}

/**
 * Relaunches Foliet after an update has been installed.
 */
export async function relaunchApplication(): Promise<void> {
  await relaunch();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  return `${value.toFixed(unitIdx === 0 ? 0 : 1)} ${units[unitIdx]}`;
}
