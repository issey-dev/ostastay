import * as React from "react"
import { cn } from "@/lib/utils"
import { InfoHint } from "@/components/ui/info-hint"
import { DocumentTitle } from "@/components/ui/document-title"
import { DashboardBreadcrumbs } from "@/components/shell/dashboard-breadcrumbs"

/**
 * THE page title row (DESKTOP_PLAN §3.2) — every dashboard page uses it, so every page has
 * the same heading size, the same place for its actions and a browser-tab title:
 *
 *   <PageHeader title="Reservations" hint="…" actions={<Button>New booking</Button>} />
 *   <PageHeader title={guestName} crumb={confirmationNo} description="…" />
 *
 * - The title is the page's only <h1> (the header's property name is not a heading).
 * - `crumb` shows "‹Sidebar item› › crumb" above the title on pages below a nav entry.
 * - Actions: at most one primary and a couple of secondary buttons; the rest belong in a More
 *   menu (`ActionBar`) — owner rule "clean over convenient" (DECISIONS 2026-09-25).
 * - Explanations go in `hint` (an InfoHint), not in a paragraph under the title.
 *
 * The actions WRAP onto their own line when they don't fit beside the title instead of
 * running off the right edge (phones).
 */
export function PageHeader({
  title,
  hint,
  description,
  crumb,
  tabTitle,
  actions,
  align = "center",
  className,
  actionsClassName = "gap-2",
}: {
  title: React.ReactNode
  /** The InfoHint text; its label is the title when that is a string. */
  hint?: React.ReactNode
  /** One short line under the title. Prefer `hint` for anything explanatory. */
  description?: React.ReactNode
  /** Label of this page in the breadcrumb trail (detail/child pages). */
  crumb?: string | null
  /** Browser-tab title when `title` is not a plain string. */
  tabTitle?: string | null
  actions?: React.ReactNode
  /** Vertical alignment of title and actions (the pages differ). */
  align?: "center" | "end"
  className?: string
  /** Spacing between the actions. */
  actionsClassName?: string
}) {
  const docTitle = tabTitle ?? (typeof title === "string" ? title : null)
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap justify-between gap-x-4 gap-y-3",
        align === "end" ? "items-end" : "items-center",
        className
      )}
    >
      <DocumentTitle title={docTitle} />
      <div className="min-w-0">
        {crumb !== undefined && <DashboardBreadcrumbs current={crumb} />}
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          {title}
          {hint && <InfoHint label={typeof title === "string" ? title : "About this page"}>{hint}</InfoHint>}
        </h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className={cn("flex flex-wrap items-center", actionsClassName)}>{actions}</div>}
    </div>
  )
}
