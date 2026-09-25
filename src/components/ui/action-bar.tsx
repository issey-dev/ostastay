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
import { MoreHorizontal } from "@/components/icons"
import type { MobileAction } from "@/components/ui/mobile"

export type ActionItem = MobileAction

/**
 * The desktop sibling of `MobileActions` (DESKTOP_PLAN §3.3): ONE primary action, at most a
 * couple of secondary buttons, and everything else in a "More" menu — destructive items last,
 * red, behind a separator (they still confirm in their own handlers). Owner rule (DECISIONS
 * 2026-09-25, "clean over convenient"): rare actions cost a click rather than a button.
 * Feed it the same action list as the phone menu so both stay in step.
 */
export function ActionBar({
  primary,
  secondary,
  more = [],
  className,
}: {
  primary?: React.ReactNode
  secondary?: React.ReactNode
  more?: ActionItem[]
  className?: string
}) {
  const safe = more.filter((a) => !a.destructive)
  const risky = more.filter((a) => a.destructive)
  if (!primary && !secondary && more.length === 0) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {secondary}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="gap-1.5" aria-label="More actions" />}>
            <MoreHorizontal className="h-4 w-4" />
            More
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
      {primary}
    </div>
  )
}
