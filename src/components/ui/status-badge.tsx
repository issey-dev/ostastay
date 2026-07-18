import { cn } from "@/lib/utils"
import { statusTone, toneMutedClasses, type StatusTone } from "@/lib/status-tone"

type StatusBadgeProps = {
  label: string
  /** Explicit tone override. Omit to resolve automatically from `status`. */
  tone?: StatusTone
  /** Raw domain status (e.g. "IN_HOUSE", "DIRTY") — resolved via the shared status-tone map. */
  status?: string
  /** Leading colored dot — for the handful of places (e.g. Property status) that need a
   * stronger at-a-glance signal than the pill's own background/text color. */
  dot?: boolean
  className?: string
}

const DOT_CLASSES: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
}

// The canonical status indicator — replaces ad hoc getStatusColor()-style helpers.
// Color always comes from the shared status-tone map (src/lib/status-tone.ts), never
// a locally chosen palette class.
export function StatusBadge({ label, tone, status, dot, className }: StatusBadgeProps) {
  const resolvedTone = tone ?? (status ? statusTone(status) : "neutral")
  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex items-center rounded-none border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneMutedClasses(resolvedTone),
        className
      )}
    >
      {dot && <span className={cn("mr-1.5 h-1.5 w-1.5 rounded-none", DOT_CLASSES[resolvedTone])} />}
      {label}
    </span>
  )
}
