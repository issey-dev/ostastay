"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useProperty } from "@/components/providers/property-provider"

// The single reusable "settings section" wrapper — every Controls tab should render its
// content inside one or more of these instead of hand-rolling Card/CardHeader/CardTitle/
// CardDescription/CardContent each time, so every section looks and behaves identically.
// The header's left edge is accented with the active property's own banner color (the
// same value PropertyBannerBar renders at the top of the page) so a long page of
// stacked sections is easier to scan — omitted entirely when the property has no
// banner color set ("None").
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
  const { currentProperty } = useProperty()
  const accentColor = currentProperty?.bannerColor

  return (
    <Card className={cn(className)}>
      <CardHeader
        className={cn("bg-muted/50 border-b border-border pb-4", accentColor && "border-l-4")}
        style={accentColor ? { borderLeftColor: accentColor } : undefined}
      >
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-6">{children}</CardContent>
    </Card>
  )
}
