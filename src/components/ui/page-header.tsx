import * as React from "react"
import { cn } from "@/lib/utils"
import { InfoHint } from "@/components/ui/info-hint"

/**
 * A page's title row: the heading (with its optional info hint) and the page's actions.
 *
 * The actions WRAP onto their own line when they don't fit beside the title instead of
 * running off the right edge — on a phone, a row of "Task Sheets · Refresh" or "Refresh ·
 * Show Resolved" next to a long title used to be cut off with no way to reach it. When the
 * row fits (every desktop width), it lays out exactly as the hand-written rows it replaces:
 * title left, actions right.
 */
export function PageHeader({
  title,
  hint,
  actions,
  align = "center",
  className,
  actionsClassName = "gap-2",
}: {
  title: React.ReactNode
  /** The InfoHint text; its label is the title when that is a string. */
  hint?: React.ReactNode
  actions?: React.ReactNode
  /** Vertical alignment of title and actions (the pages differ). */
  align?: "center" | "end"
  className?: string
  /** Spacing between the actions — kept per page so each looks exactly as before. */
  actionsClassName?: string
}) {
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-wrap justify-between gap-x-4 gap-y-3",
        align === "end" ? "items-end" : "items-center",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
          {title}
          {hint && <InfoHint label={typeof title === "string" ? title : "About this page"}>{hint}</InfoHint>}
        </h2>
      </div>
      {actions && <div className={cn("flex flex-wrap items-center", actionsClassName)}>{actions}</div>}
    </div>
  )
}
