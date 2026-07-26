import type { ComponentType } from "react"
import { cn } from "@/lib/utils"
import { AlertTriangle, RefreshCw } from "@/components/icons"
import { Button } from "@/components/ui/button"

type ErrorStateProps = {
  // Accepts any icon component (lucide or the mx-icons two-tone adapter in @/components/icons).
  icon?: ComponentType<{ className?: string }>
  title?: string
  description?: string
  // When provided, renders a "Try again" button wired to it.
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

// The canonical "couldn't load" state — the error-path sibling of EmptyState. Use it when a
// data fetch FAILS (network error, 500, non-array payload), so a load failure reads as a real
// error with a retry, never as an empty list. Distinct from EmptyState, which means "loaded
// fine, but there's nothing here."
export function ErrorState({
  icon: Icon = AlertTriangle,
  title = "Couldn't load this",
  description = "Something went wrong while loading. Check your connection and try again.",
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-none bg-destructive/10">
        <Icon className="h-6 w-6 text-destructive" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {onRetry && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" />
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
