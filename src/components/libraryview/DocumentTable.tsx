import {
  BookOpen,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { PdfService } from "@/services/pdf";
import type { CatalogItem } from "@/types/catalog";

interface DocumentTableProps {
  documents: CatalogItem[];
  totalCount: number;
  collections: string[];
  onOpenDoc: (doc: CatalogItem) => void;
  onForgetDoc: (docId: string) => void;
  onSetDocCollection: (docId: string, collection?: string) => void;
}

const formatOpenedAt = (ts: number) => {
  const diffDays = Math.floor((Date.now() - ts) / 86_400_000);
  const time = new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

export const formatBytes = (bytes: number) =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function DocumentTable({
  documents,
  totalCount,
  collections,
  onOpenDoc,
  onForgetDoc,
  onSetDocCollection,
}: DocumentTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-[1fr_80px_96px_120px] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
        <span>Document</span>
        <span className="text-right">Pages</span>
        <span className="text-right">Notes</span>
        <span className="text-right">Opened</span>
      </div>

      <div className="divide-y divide-border">
        {documents.map((doc) => (
          <ContextMenu key={doc.id}>
            <ContextMenuTrigger>
              <button
                type="button"
                onClick={() => onOpenDoc(doc)}
                className="grid w-full grid-cols-[1fr_80px_96px_120px] items-center gap-4 px-4 py-3 text-left transition-colors duration-150 ease-[var(--ease-foliet)] hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FileText
                    size={16}
                    strokeWidth={1.5}
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {doc.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {doc.authors
                        ? `${doc.authors}${doc.year ? ` · ${doc.year}` : ""}`
                        : `${doc.fileName} · ${formatBytes(doc.fileSize)}`}
                      {doc.collection ? ` · ${doc.collection}` : ""}
                    </div>
                  </div>
                </div>

                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {doc.pageCount}
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                  {doc.annotationCount ?? 0}
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {formatOpenedAt(doc.lastOpenedAt)}
                </span>
              </button>
            </ContextMenuTrigger>

            <ContextMenuContent className="w-48">
              <ContextMenuItem onClick={() => onOpenDoc(doc)}>
                <BookOpen size={16} strokeWidth={1.5} />
                Open
              </ContextMenuItem>

              {collections.length > 0 && (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <FolderOpen size={16} strokeWidth={1.5} />
                    Collection
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-44">
                    {collections.map((col) => {
                      const assigned = doc.collection === col;
                      return (
                        <ContextMenuCheckboxItem
                          key={col}
                          checked={assigned}
                          onCheckedChange={() =>
                            onSetDocCollection(
                              doc.id,
                              assigned ? undefined : col,
                            )
                          }
                        >
                          <span className="truncate">{col}</span>
                        </ContextMenuCheckboxItem>
                      );
                    })}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              )}

              <ContextMenuItem
                onClick={async () => {
                  if (!(await PdfService.revealInFolder(doc.filePath))) {
                    toast.error("File location unavailable");
                  }
                }}
              >
                <ExternalLink size={16} strokeWidth={1.5} />
                Reveal in folder
              </ContextMenuItem>

              <ContextMenuItem
                onClick={async () => {
                  await navigator.clipboard.writeText(doc.title);
                  toast.success("Title copied");
                }}
              >
                <Copy size={16} strokeWidth={1.5} />
                Copy title
              </ContextMenuItem>

              <ContextMenuSeparator />

              <ContextMenuItem
                variant="destructive"
                onClick={() => onForgetDoc(doc.id)}
              >
                <Trash2 size={16} strokeWidth={1.5} />
                Remove from library
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}

        {documents.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <p className="text-sm font-medium text-foreground">
              {totalCount === 0 ? "No papers yet" : "No matching documents"}
            </p>
            <p className="text-xs text-muted-foreground">
              {totalCount === 0
                ? "Import a PDF or drop one anywhere in this window"
                : "Try clearing your search or collection filter"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
