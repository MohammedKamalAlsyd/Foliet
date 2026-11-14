import type { RefObject } from "react";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SearchOverlayProps {
  isOpen: boolean;
  searchQuery: string;
  isSearching: boolean;
  totalMatches: number;
  currentMatchIndex: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function SearchOverlay({
  isOpen,
  searchQuery,
  isSearching,
  totalMatches,
  currentMatchIndex,
  searchInputRef,
  onQueryChange,
  onNext,
  onPrev,
  onClose,
}: SearchOverlayProps) {
  if (!isOpen) return null;

  return (
    <div className="absolute top-14 right-6 z-40 flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-[var(--shadow-float)]">
      <div className="relative flex items-center">
        {isSearching ? (
          <Loader2
            size={16}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2.5 animate-spin text-muted-foreground"
          />
        ) : (
          <Search
            size={16}
            strokeWidth={1.5}
            className="pointer-events-none absolute left-2.5 text-muted-foreground"
          />
        )}
        <Input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Find in paper"
          className="h-8 w-52 pl-8 pr-2 text-xs"
        />
      </div>

      <span className="min-w-14 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {totalMatches > 0
          ? `${currentMatchIndex + 1} / ${totalMatches}`
          : searchQuery.trim() && !isSearching
            ? "0 / 0"
            : ""}
      </span>

      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={totalMatches === 0}
          onClick={onPrev}
          aria-label="Previous match"
          className="h-7 w-7"
        >
          <ChevronUp size={16} strokeWidth={1.5} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={totalMatches === 0}
          onClick={onNext}
          aria-label="Next match"
          className="h-7 w-7"
        >
          <ChevronDown size={16} strokeWidth={1.5} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close search"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <X size={16} strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}
