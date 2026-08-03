"use client"

import { useState } from "react"
import { Info } from "@/components/icons"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// The ⓘ that replaced the app's page and card subheadings (app-owner decision,
// 2026-08-03: "most things are self explanatory... if it's needed put an information
// icon that when clicked or hovered over shows any information needed").
//
// One control, two interactions, because the app is used on a desk AND on a phone:
//   - pointer devices open it on hover, so a mouse user gets the old subheading back
//     without a click;
//   - touch devices have no hover, so the same icon is a real tap target that opens a
//     dismissible popover.
// A Popover rather than a Tooltip is what makes that possible — Tooltip is hover/focus
// only, so on a phone the help would simply be unreachable.
//
// It is a <button> (not a div) so it is keyboard-reachable and screen-reader-announced;
// the label names the thing being explained rather than saying "info", which would give
// a screen-reader user a page full of identical "info" buttons.
export function InfoHint({
  children,
  label,
  className,
}: {
  /** The explanatory text — usually the sentence that used to sit under the heading. */
  children: React.ReactNode
  /** What this explains, e.g. "Reservations & Stays". Used for the accessible name. */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label ? `About ${label}` : "More information"}
            // Hover opens on pointer devices; onClick (via the trigger) covers touch.
            // Deliberately not onMouseLeave-to-close on its own — moving the pointer
            // into the popover would otherwise dismiss it mid-read.
            onMouseEnter={() => setOpen(true)}
            className={`inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring align-middle ${className ?? ""}`}
          />
        }
      >
        <Info className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent
        // Narrow on purpose: this is a sentence or two of help, not a panel.
        className="max-w-xs text-sm font-normal leading-relaxed text-muted-foreground"
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
