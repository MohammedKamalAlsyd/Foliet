import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Toaster, toast } from "sonner";
import type { Update } from "@tauri-apps/plugin-updater";
import { Titlebar } from "@/components/Titlebar";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { UpdateModal } from "@/components/modals/UpdateModal";
import { LibraryView } from "@/pages/LibraryView";
import { ViewerView } from "@/pages/ViewerView";
import {
  checkForUpdates,
  dismissUpdateHandle,
  downloadAndInstallUpdate,
  relaunchApplication,
  type UpdateDownloadProgress,
} from "@/services/updater";
import { WindowService } from "@/services/window";
import { useAiConfigStore } from "@/stores/aiConfigStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";

type PendingLeave = "home" | "close" | "update-install" | "update-relaunch" | null;

// Microsoft Store (MSIX) builds receive updates through the Store itself.
const IS_STORE_BUILD = import.meta.env.VITE_STORE_BUILD === "true";

export function App() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const closeDocument = useDocumentStore((s) => s.closeDocument);
  const isDark = useSystemStore((s) => s.isDark);
  const forceClosingRef = useRef(false);

  const [pendingLeave, setPendingLeave] = useState<PendingLeave>(null);

  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] =
    useState<UpdateDownloadProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const availableUpdateRef = useRef<Update | null>(null);

  useEffect(() => {
    availableUpdateRef.current = availableUpdate;
  }, [availableUpdate]);

  useEffect(() => {
    return () => {
      void dismissUpdateHandle(availableUpdateRef.current);
    };
  }, []);

  // Hydrate encrypted API keys (and migrate/scrub any legacy plaintext entries) once at startup
  useEffect(() => {
    void useAiConfigStore.getState().hydrateSecrets();
  }, []);

  // Silent startup update check in standalone production builds only (disabled in Store MSIX builds)
  useEffect(() => {
    if (!import.meta.env.PROD || IS_STORE_BUILD) return;
    let active = true;

    void checkForUpdates({ silent: true }).then(({ update }) => {
      if (!active) {
        void dismissUpdateHandle(update);
        return;
      }
      if (!update) return;

      setAvailableUpdate((prev) => {
        if (prev && prev !== update) void dismissUpdateHandle(prev);
        return update;
      });
      toast(`Foliet v${update.version} is available`, {
        description: "Click to view release notes and update.",
        action: {
          label: "Update",
          onClick: () => setIsUpdateModalOpen(true),
        },
      });
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    WindowService.onCloseRequested((event) => {
      if (forceClosingRef.current) return;
      if (useDocumentStore.getState().isDirty) {
        event.preventDefault();
        setPendingLeave("close");
      }
    })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {});

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  const handleCheckForUpdates = useCallback(async () => {
    if (availableUpdate) {
      setUpdateError(null);
      setIsUpdateModalOpen(true);
      return;
    }
    if (isCheckingUpdates) return;

    setIsCheckingUpdates(true);
    try {
      const { update, error } = await checkForUpdates({ silent: false });
      if (error) {
        toast.error("Could not check for updates", { description: error });
        return;
      }
      if (update) {
        setAvailableUpdate(update);
        setUpdateError(null);
        setUpdateProgress(null);
        setIsUpdateModalOpen(true);
      } else {
        toast.success("Foliet is up to date");
      }
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [availableUpdate, isCheckingUpdates]);

  const performRelaunch = useCallback(async () => {
    forceClosingRef.current = true;
    try {
      await relaunchApplication();
    } catch (err) {
      forceClosingRef.current = false;
      const message =
        err instanceof Error ? err.message : "Failed to restart Foliet.";
      setUpdateError(message);
    }
  }, []);

  const executeUpdateInstall = useCallback(
    async (confirmedDiscard: boolean) => {
      const update = availableUpdateRef.current;
      if (!update || isInstallingUpdate) return;

      setIsInstallingUpdate(true);
      setUpdateError(null);
      setUpdateProgress({
        phase: "started",
        downloadedBytes: 0,
        percent: null,
      });

      try {
        await downloadAndInstallUpdate(update, (progress) => {
          setUpdateProgress(progress);
        });

        // Safety guard before calling relaunch(): never silently discard unsaved annotations
        if (useDocumentStore.getState().isDirty && !confirmedDiscard) {
          setIsInstallingUpdate(false);
          setPendingLeave("update-relaunch");
          return;
        }

        await performRelaunch();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Update download or installation failed.";
        setUpdateError(message);
        setIsInstallingUpdate(false);
      }
    },
    [isInstallingUpdate, performRelaunch],
  );

  const requestUpdateInstall = useCallback(() => {
    if (useDocumentStore.getState().isDirty) {
      setPendingLeave("update-install");
      return;
    }
    void executeUpdateInstall(false);
  }, [executeUpdateInstall]);

  const requestHome = () => {
    if (isDirty) setPendingLeave("home");
    else closeDocument();
  };

  const requestClose = () => {
    if (isDirty) setPendingLeave("close");
    else WindowService.close();
  };

  const isUpdatePendingLeave =
    pendingLeave === "update-install" || pendingLeave === "update-relaunch";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <Titlebar
        onNavigateHome={requestHome}
        onRequestClose={requestClose}
        onCheckForUpdates={IS_STORE_BUILD ? undefined : handleCheckForUpdates}
        isCheckingUpdates={isCheckingUpdates}
        hasUpdateAvailable={availableUpdate !== null}
      />

      {!activeDoc ? <LibraryView /> : <ViewerView />}

      <UpdateModal
        open={isUpdateModalOpen}
        onOpenChange={setIsUpdateModalOpen}
        update={availableUpdate}
        isInstalling={isInstallingUpdate}
        progress={updateProgress}
        error={updateError}
        onInstallAndRestart={requestUpdateInstall}
      />

      <ConfirmModal
        open={pendingLeave !== null}
        onOpenChange={(open) => !open && setPendingLeave(null)}
        icon={AlertTriangle}
        destructive
        title="Unsaved annotations"
        description={
          isUpdatePendingLeave
            ? "You have unsaved edits in this document. Installing the update will restart Foliet and discard unsaved changes. Cancel to save first, or continue without saving?"
            : "You have unsaved edits in this document. Leave without saving?"
        }
        meta={activeDoc?.title}
        confirmLabel={
          isUpdatePendingLeave ? "Discard & update" : "Discard edits"
        }
        onConfirm={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          if (action === "home") {
            closeDocument();
          } else if (action === "close") {
            forceClosingRef.current = true;
            WindowService.close().catch(() => {
              forceClosingRef.current = false;
            });
          } else if (action === "update-install") {
            void executeUpdateInstall(true);
          } else if (action === "update-relaunch") {
            void performRelaunch();
          }
        }}
      />

      <Toaster theme={isDark ? "dark" : "light"} position="bottom-right" />
    </div>
  );
}

export default App;
