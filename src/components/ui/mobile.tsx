"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Monitor } from "@/components/icons"

// Shared building blocks for the phone layouts (.agents/docs/MOBILE_PLAN.md §4). Every one
// of them renders only below `md` (or takes a className that does), so a screen adopts them
// next to its unchanged desktop markup — desktop never sees them.

export type MobileAction = {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  onSelect: () => void
  disabled?: boolean
  /** Red, and grouped last behind a separator (reversals, deletes, no-shows). */
  destructive?: boolean
}

/**
 * The phone version of a row of action buttons: ONE primary action (full width) and a
 * "More" menu for the rest. Replaces rows of 4–7 buttons that wrapped into several lines
 * before any content. Risky actions go last, in red, behind a separator — and should still
 * confirm on their own.
 *
 *   <div className="hidden md:flex …">{desktop buttons, unchanged}</div>
 *   <MobileActions className="md:hidden" primary={<Button>Check out</Button>} more={[…]} />
 */
export function MobileActions({
  primary,
  more = [],
  className,
  moreLabel = "More",
}: {
  primary?: React.ReactNode
  more?: MobileAction[]
  className?: string
  moreLabel?: string
}) {
  const safe = more.filter((a) => !a.destructive)
  const risky = more.filter((a) => a.destructive)
  if (!primary && more.length === 0) return null
  return (
    <div className={cn("flex items-stretch gap-2 [&>*:first-child:not(:last-child)]:flex-1", className)}>
      {primary}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className={cn("gap-1.5", !primary && "flex-1")} aria-label={`${moreLabel} actions`} />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
            {moreLabel}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {safe.map((a) => (
              <DropdownMenuItem key={a.label} disabled={a.disabled} onClick={a.onSelect}>
                {a.icon && <a.icon className="h-4 w-4" />}
                {a.label}
              </DropdownMenuItem>
            ))}
            {risky.length > 0 && safe.length > 0 && <DropdownMenuSeparator />}
            {risky.map((a) => (
              <DropdownMenuItem key={a.label} variant="destructive" disabled={a.disabled} onClick={a.onSelect}>
                {a.icon && <a.icon className="h-4 w-4" />}
                {a.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

/**
 * A bar pinned to the bottom of a phone screen for the screen's primary action — "Book
 * now", "Post $120 to Room 101", "Save" — so it never scrolls out of reach. Sits above the
 * bottom nav when one is showing (--bottom-nav-offset) and clear of the home indicator, and
 * leaves a spacer of its own height in the page so the last field isn't hidden under it.
 * `md:hidden`: desktop keeps its in-page buttons.
 */
export function MobileActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <>
      <div aria-hidden className="h-20 md:hidden" />
      <div
        data-mobile-action-bar=""
        className={cn(
          "fixed inset-x-0 bottom-[var(--bottom-nav-offset,0px)] z-[var(--z-sticky)] flex items-center gap-2 border-t border-border bg-card/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md md:hidden print:hidden",
          className
        )}
      >
        {children}
      </div>
    </>
  )
}

/**
 * Below `md`, stands in for a screen or feature that is built for a large display (a
 * spreadsheet-like editor, a wide grid, a print document). The content itself stays reachable
 * on desktop; on a phone the user gets a friendly line instead of a cramped, error-prone
 * version — plus an optional read-only `fallback`.
 */
export function DesktopOnly({
  feature,
  children,
  fallback,
  description,
}: {
  feature: string
  children: React.ReactNode
  fallback?: React.ReactNode
  description?: string
}) {
  return (
    <>
      <div className="md:hidden">
        <DesktopOnlyNotice feature={feature} description={description} />
        {fallback && <div className="mt-4">{fallback}</div>}
      </div>
      <div className="hidden md:contents">{children}</div>
    </>
  )
}

/** The notice alone — "Open on a computer to …". Phones only. */
export function DesktopOnlyNotice({
  feature,
  description,
  className,
}: {
  feature: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm md:hidden",
        className
      )}
    >
      <Monitor className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div>
        <p className="font-medium text-foreground">{feature} is best on a larger screen</p>
        <p className="mt-0.5 text-muted-foreground">
          {description ?? "Open this page on a tablet or computer to make changes here."}
        </p>
      </div>
    </div>
  )
}
