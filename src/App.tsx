import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Toaster } from "sonner";
import { Titlebar } from "@/components/Titlebar";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { LibraryView } from "@/pages/LibraryView";
import { ViewerView } from "@/pages/ViewerView";
import { WindowService } from "@/services/window";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";

type PendingLeave = "home" | "close" | null;

export function App() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const isDirty = useDocumentStore((s) => s.isDirty);
  const closeDocument = useDocumentStore((s) => s.closeDocument);
  const isDark = useSystemStore((s) => s.isDark);
  const forceClosingRef = useRef(false);

  const [pendingLeave, setPendingLeave] = useState<PendingLeave>(null);

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

  const requestHome = () => {
    if (isDirty) setPendingLeave("home");
    else closeDocument();
  };

  const requestClose = () => {
    if (isDirty) setPendingLeave("close");
    else WindowService.close();
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <Titlebar onNavigateHome={requestHome} onRequestClose={requestClose} />

      {!activeDoc ? <LibraryView /> : <ViewerView />}

      <ConfirmModal
        open={pendingLeave !== null}
        onOpenChange={(open) => !open && setPendingLeave(null)}
        icon={AlertTriangle}
        destructive
        title="Unsaved annotations"
        description="You have unsaved edits in this document. Leave without saving?"
        meta={activeDoc?.title}
        confirmLabel="Discard edits"
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
          }
        }}
      />

      <Toaster theme={isDark ? "dark" : "light"} position="bottom-right" />
    </div>
  );
}

export default App;
