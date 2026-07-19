"use client"

import { StationariesManager } from "@/components/settings/stationaries-manager"
import { useProperty } from "@/components/providers/property-provider"
import { cn } from "@/lib/utils"

export default function StationariesPage() {
  const { currentProperty } = useProperty()
  const accentColor = currentProperty?.bannerColor

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div
        className={cn("space-y-1", accentColor && "border-l-4 pl-4")}
        style={accentColor ? { borderLeftColor: accentColor } : undefined}
      >
        <h2 className="text-2xl font-bold tracking-tight">Stationaries</h2>
        <p className="text-sm text-muted-foreground">
          Branding, layout, and content for every printable/emailable document — Invoices, Confirmation Letters, Payment Receipts, Currency Exchange Receipts, and Debtor Statements.
        </p>
      </div>
      <StationariesManager />
    </div>
  )
}
