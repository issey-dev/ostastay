import { cn } from "@/lib/utils"
import { statusTone, toneMutedClasses, type StatusTone } from "@/lib/status-tone"

type StatusBadgeProps = {
  label: string
  /** Explicit tone override. Omit to resolve automatically from `status`. */
  tone?: StatusTone
  /** Raw domain status (e.g. "IN_HOUSE", "DIRTY") — resolved via the shared status-tone map. */
  status?: string
  className?: string
}

// The canonical status indicator — replaces ad hoc getStatusColor()-style helpers.
// Color always comes from the shared status-tone map (src/lib/status-tone.ts), never
// a locally chosen palette class.
export function StatusBadge({ label, tone, status, className }: StatusBadgeProps) {
  const resolvedTone = tone ?? (status ? statusTone(status) : "neutral")
  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneMutedClasses(resolvedTone),
        className
      )}
    >
      {label}
    </span>
  )
}
