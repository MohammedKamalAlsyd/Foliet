import { Toaster } from "sonner";
import { Titlebar } from "@/components/Titlebar";
import { LibraryView } from "@/pages/LibraryView";
import { useDocumentStore } from "@/stores/documentStore";
import { useSystemStore } from "@/stores/systemStore";

export function App() {
  const activeDoc = useDocumentStore((s) => s.activeDoc);
  const isViewerOpen = useDocumentStore((s) => s.isViewerOpen);
  const isDark = useSystemStore((s) => s.isDark);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
      <Titlebar />

      {!isViewerOpen ? (
        <LibraryView />
      ) : (
        /* Part 2 will mount <ViewerView /> here */
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Viewer ready for {activeDoc?.title} ({activeDoc?.pages} pages)
        </main>
      )}

      <Toaster theme={isDark ? "dark" : "light"} position="bottom-center" />
    </div>
  );
}

export default App;
