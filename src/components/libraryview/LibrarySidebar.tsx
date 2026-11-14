import { useState } from "react";
import {
  BookOpen,
  Clock,
  Folder,
  Highlighter,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { FullLogo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type NavFilter = "all" | "recent" | "annotated";

interface LibrarySidebarProps {
  nav: NavFilter;
  selectedCollection: string | null;
  counts: Record<NavFilter, number>;
  collections: string[];
  collectionCounts: Record<string, number>;
  documentCount: number;
  storageSummary: string;
  onSelectNav: (nav: NavFilter) => void;
  onSelectCollection: (name: string | null) => void;
  onCreateCollection: (name: string) => Promise<string | null>;
  onRenameCollection: (
    oldName: string,
    newName: string,
  ) => Promise<string | null>;
  onRequestDeleteCollection: (name: string) => void;
  onRequestClearAll: () => void;
}

export function LibrarySidebar({
  nav,
  selectedCollection,
  counts,
  collections,
  collectionCounts,
  documentCount,
  storageSummary,
  onSelectNav,
  onSelectCollection,
  onCreateCollection,
  onRenameCollection,
  onRequestDeleteCollection,
  onRequestClearAll,
}: LibrarySidebarProps) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const navItems: {
    id: NavFilter;
    label: string;
    icon: typeof BookOpen;
    count: number;
  }[] = [
    { id: "all", label: "All papers", icon: BookOpen, count: counts.all },
    { id: "recent", label: "Recent", icon: Clock, count: counts.recent },
    {
      id: "annotated",
      label: "Annotated",
      icon: Highlighter,
      count: counts.annotated,
    },
  ];

  const submitCreate = async () => {
    const created = await onCreateCollection(draftName);
    setDraftName("");
    setCreating(false);
    if (created) onSelectCollection(created);
  };

  const submitRename = async (oldName: string) => {
    const renamed = await onRenameCollection(oldName, renameDraft);
    setRenamingCol(null);
    setRenameDraft("");
    if (renamed && selectedCollection === oldName) {
      onSelectCollection(renamed);
    }
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-border bg-muted/30 p-4">
      <div className="flex flex-col gap-6 overflow-y-auto">
        <FullLogo size="sm" subtitle="Research library" />

        <nav aria-label="Library sections" className="flex flex-col gap-1">
          {navItems.map(({ id, label, icon: Icon, count }) => {
            const active = nav === id && !selectedCollection;
            return (
              <Button
                key={id}
                type="button"
                variant="ghost"
                onClick={() => {
                  onSelectNav(id);
                  onSelectCollection(null);
                }}
                className={cn(
                  "h-8 w-full justify-between px-3 text-sm",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "font-normal text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon size={16} strokeWidth={1.5} />
                  <span>{label}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {count}
                </span>
              </Button>
            );
          })}
        </nav>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between pl-3 pr-1">
            <span className="text-xs font-medium text-muted-foreground">
              Collections
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="New collection"
              title="New collection"
              onClick={() => {
                setCreating(true);
                setDraftName("");
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus size={16} strokeWidth={1.5} />
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            {creating && (
              <Input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCreate();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setDraftName("");
                  }
                }}
                onBlur={() => {
                  if (draftName.trim()) submitCreate();
                  else setCreating(false);
                }}
                placeholder="Collection name"
                className="h-8 px-3 text-sm"
              />
            )}

            {collections.map((name) => {
              if (renamingCol === name) {
                return (
                  <Input
                    key={name}
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitRename(name);
                      } else if (e.key === "Escape") {
                        setRenamingCol(null);
                      }
                    }}
                    onBlur={() => submitRename(name)}
                    className="h-8 px-3 text-sm"
                  />
                );
              }

              const active = selectedCollection === name;
              return (
                <ContextMenu key={name}>
                  <ContextMenuTrigger>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onSelectCollection(active ? null : name)}
                      className={cn(
                        "h-8 w-full justify-between px-3 text-sm",
                        active
                          ? "bg-accent font-medium text-accent-foreground"
                          : "font-normal text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Folder
                          size={16}
                          strokeWidth={1.5}
                          className="shrink-0"
                        />
                        <span className="truncate">{name}</span>
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {collectionCounts[name] ?? 0}
                      </span>
                    </Button>
                  </ContextMenuTrigger>

                  <ContextMenuContent className="w-44">
                    <ContextMenuItem
                      onClick={() => {
                        setRenamingCol(name);
                        setRenameDraft(name);
                      }}
                    >
                      <Pencil size={16} strokeWidth={1.5} />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => onRequestDeleteCollection(name)}
                    >
                      <Trash2 size={16} strokeWidth={1.5} />
                      Delete collection
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}

            {collections.length === 0 && !creating && (
              <p className="px-3 py-1 text-xs text-muted-foreground">
                No collections yet
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-4">
        <Separator />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Local storage</span>
          <span className="font-mono tabular-nums">{storageSummary}</span>
        </div>
        {documentCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRequestClearAll}
            className="h-8 justify-start gap-2 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={16} strokeWidth={1.5} />
            <span>Clear library</span>
          </Button>
        )}
      </div>
    </aside>
  );
}
