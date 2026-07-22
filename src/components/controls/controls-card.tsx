"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// The single reusable "settings section" wrapper — every Controls tab should render its
// content inside one or more of these instead of hand-rolling Card/CardHeader/CardTitle/
// CardDescription/CardContent each time, so every section looks and behaves identically.
// Header and body share one continuous surface (no shaded band / divider) — separation is
// carried by the card's own elevation + spacing. The subtle per-property accent on the
// card's left edge is applied globally by PropertyAccentScope (see the dashboard layout),
// so every card across the app picks it up, not just Controls.
export function ControlsCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-0">
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-6 pt-4">{children}</CardContent>
    </Card>
  )
}
