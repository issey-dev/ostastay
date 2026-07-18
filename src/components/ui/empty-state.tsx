import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

// The canonical "no data" state — replaces bare "No results" strings scattered across
// tables/lists so every empty list in the app looks and reads the same way.
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-none bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
