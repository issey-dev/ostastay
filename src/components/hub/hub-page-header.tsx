import type { ComponentType, ReactNode } from "react"
import { InfoHint } from "@/components/ui/info-hint"

// Heading for a Hub setup page. `scope` says, in words, whose settings these are — the
// property band above already names the property; this line repeats the rule so a page
// can never be read as applying anywhere else.
export function HubPageHeader({
  title,
  icon: Icon,
  scope,
  hint,
  children,
}: {
  title: string
  icon?: ComponentType<{ className?: string }>
  scope: "property" | "enterprise" | "interim"
  hint?: string
  children?: ReactNode
}) {
  const scopeLine =
    scope === "property"
      ? "These settings apply to this property only."
      : scope === "enterprise"
        ? "Shared by every property in this enterprise."
        : "Shared by every property for now — these are moving into each property's own setup."

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
          {title}
          {hint && <InfoHint label={title}>{hint}</InfoHint>}
        </h2>
        <p className={scope === "interim" ? "mt-1 text-sm text-warning" : "mt-1 text-sm text-muted-foreground"}>
          {scopeLine}
        </p>
      </div>
      {children}
    </div>
  )
}
