"use client"

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InfoHint } from "@/components/ui/info-hint"
import { cn } from "@/lib/utils"

// The single reusable "settings section" wrapper — every Controls tab should render its
// content inside one or more of these instead of hand-rolling Card/CardHeader/CardTitle/
// CardDescription/CardContent each time, so every section looks and behaves identically.
// Header and body share one continuous surface (no shaded band / divider) — separation is
// carried by the card's own elevation + spacing. (Card headers used to carry a thin
// per-property accent edge; that was removed when the Uppsolut palette landed — see the
// note in globals.css.)
//
// `action` is the card's primary control (usually an "Add …" button). It renders in the
// header, top-right, aligned with the title — the "Table + Button" card in the
// Settings.dc.html design. This is the ONE place a section's primary action should live;
// managers should pass it here rather than rendering a separate button row inside the
// body (which put the button on its own line below the description — the old look).
export function ControlsCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn(className)}>
      {/* No pb override: CardHeader's own symmetric py keeps the accent-edged header
          box balanced (equal space above the title and below the description). The
          content's pt-0 compensates, so the total title→content rhythm matches the
          rest of the app's cards. */}
      {/* `description` is no longer rendered as a subheading — it moved into the ⓘ
          beside the title (app-owner decision, 2026-08-03). Every Controls section gets
          this for free by going through this component, so call sites keep passing the
          same prop and nothing had to be edited 30 times. */}
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {title}
          {description && <InfoHint label={title}>{description}</InfoHint>}
        </CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="p-6 pt-0">{children}</CardContent>
    </Card>
  )
}
