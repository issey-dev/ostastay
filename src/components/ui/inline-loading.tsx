import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

// The one small loading state for a section or panel (DESKTOP_PLAN D8: 31 "Loading..." texts
// in two spellings). Skeleton lines, not a spinner — the page keeps its shape while it loads.
// Spinners stay for buttons ("Saving…") and the big grids only.
export function InlineLoading({ lines = 3, className, label = "Loading" }: { lines?: number; className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("space-y-2 py-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  )
}
