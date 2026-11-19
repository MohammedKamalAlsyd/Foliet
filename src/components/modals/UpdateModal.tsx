import { ArrowUpCircle, Download, Loader2, RefreshCw } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatBytes,
  type UpdateDownloadProgress,
} from "@/services/updater";

interface UpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  update: Update | null;
  isInstalling: boolean;
  progress: UpdateDownloadProgress | null;
  error: string | null;
  onInstallAndRestart: () => void;
}

export function UpdateModal({
  open,
  onOpenChange,
  update,
  isInstalling,
  progress,
  error,
  onInstallAndRestart,
}: UpdateModalProps) {
  if (!update) return null;

  const progressPercent =
    progress?.percent !== null && progress?.percent !== undefined
      ? progress.percent
      : null;

  const statusLabel = (() => {
    if (!isInstalling) return null;
    if (!progress || progress.phase === "started") {
      return "Starting download…";
    }
    if (progress.phase === "finished") {
      return "Installing update & restarting…";
    }
    if (progress.contentLength && progress.contentLength > 0) {
      return `Downloading ${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.contentLength)}${progressPercent !== null ? ` (${progressPercent}%)` : ""}`;
    }
    return `Downloading ${formatBytes(progress.downloadedBytes)}…`;
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isInstalling) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!isInstalling}
        className="sm:max-w-md"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
            <ArrowUpCircle size={16} strokeWidth={1.5} />
          </div>

          <DialogHeader className="min-w-0 flex-1">
            <DialogTitle>Update available</DialogTitle>
            <DialogDescription>
              A newer version of Foliet is ready to install.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs tabular-nums">
          <span className="text-muted-foreground">
            v{update.currentVersion} →{" "}
            <span className="font-semibold text-foreground">
              v{update.version}
            </span>
          </span>
          {update.date && (
            <span className="text-[11px] text-muted-foreground">
              {update.date.slice(0, 10)}
            </span>
          )}
        </div>

        {update.body && update.body.trim().length > 0 && (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">
              Release notes
            </div>
            <div className="max-h-44 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground/90">
              {update.body.trim()}
            </div>
          </div>
        )}

        {isInstalling && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                <span>{statusLabel}</span>
              </span>
              {progressPercent !== null && (
                <span className="font-mono tabular-nums">{progressPercent}%</span>
              )}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--accent-brand,#2563EB)] transition-[width] duration-150"
                style={{
                  width:
                    progressPercent !== null
                      ? `${progressPercent}%`
                      : progress?.phase === "finished"
                        ? "100%"
                        : "35%",
                }}
              />
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}

        <DialogFooter className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isInstalling}
            onClick={() => onOpenChange(false)}
            className="h-8 px-3 text-xs"
          >
            Later
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isInstalling}
            onClick={onInstallAndRestart}
            className="h-8 gap-1.5 px-3 text-xs"
          >
            {isInstalling ? (
              <>
                <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
                <span>Updating…</span>
              </>
            ) : error ? (
              <>
                <RefreshCw size={14} strokeWidth={1.5} />
                <span>Retry update</span>
              </>
            ) : (
              <>
                <Download size={14} strokeWidth={1.5} />
                <span>Update & Restart</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
