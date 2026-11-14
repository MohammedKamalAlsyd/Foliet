import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  meta?: string;
  icon?: LucideIcon;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  isPending?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  meta,
  icon: Icon,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  isPending = false,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !isPending && onOpenChange(next)}
    >
      <AlertDialogContent>
        <div className="flex items-start gap-3">
          {Icon && (
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                destructive
                  ? "border-destructive/20 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-muted-foreground",
              )}
            >
              <Icon size={16} strokeWidth={1.5} />
            </div>
          )}

          <AlertDialogHeader className="min-w-0 flex-1">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
        </div>

        {meta && (
          <div className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
            {meta}
          </div>
        )}

        <AlertDialogFooter className="pt-1 sm:justify-between">
          <div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <kbd>Esc</kbd>
            <span>to cancel</span>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogCancel disabled={isPending} className="h-8 px-3">
              {cancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={destructive ? "destructive" : "default"}
              disabled={isPending}
              onClick={onConfirm}
              className="h-8 gap-2 px-3"
            >
              {isPending && (
                <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
              )}
              <span>{confirmLabel}</span>
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
