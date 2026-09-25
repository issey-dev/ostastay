import type { ComponentType, ReactNode } from "react"
import { InfoHint } from "@/components/ui/info-hint"
import { DocumentTitle } from "@/components/ui/document-title"
import { HubSectionNav } from "@/components/hub/hub-section-nav"

// Heading for a Hub setup page. `scope` says, in words, whose settings these are — the
// property band above already names the property; this line repeats the rule so a page
// can never be read as applying anywhere else. A page that belongs to neither area (the
// Hub Overview spans both) passes `description` instead of `scope`.
export function HubPageHeader({
  title,
  icon: Icon,
  scope,
  description,
  hint,
  children,
}: {
  title: string
  icon?: ComponentType<{ className?: string }>
  scope?: "property" | "enterprise"
  // One short line in place of the scope line.
  description?: ReactNode
  hint?: string
  children?: ReactNode
}) {
  const scopeLine =
    description ??
    (scope === "property"
      ? "These settings apply to this property only."
      : scope === "enterprise"
        ? "Shared by every property in this enterprise."
        : null)

  return (
    <>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <DocumentTitle title={`${title} · Hub`} />
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
          {title}
          {hint && <InfoHint label={title}>{hint}</InfoHint>}
        </h1>
        {scopeLine && <p className="mt-1 text-sm text-muted-foreground">{scopeLine}</p>}
      </div>
      {children}
    </div>
    {/* Jump links, on long pages only (3+ sections). */}
    <HubSectionNav />
    </>
  )
}
