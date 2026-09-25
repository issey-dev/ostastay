"use client"

import { useProperty } from "@/components/providers/property-provider"
import { Building2, CalendarClock } from "@/components/icons"
import { LogoTile } from "@/components/ui/logo-tile"

// The header brand block: the active property's logo + name, with the enterprise
// name beneath. Property data is client-side (PropertyProvider) so it updates on a
// property switch; the enterprise name is stable and passed from the server layout.
export function HeaderBrand({ enterpriseName }: { enterpriseName: string }) {
  const { currentProperty } = useProperty()

  return (
    <div className="flex items-center gap-3 min-w-0">
      {currentProperty?.logoUrl ? (
        // The 3:2 logo on a white tile — readable on the dark header whatever its colours.
        <LogoTile src={currentProperty.logoUrl} className="h-9 w-[54px] shadow-elevation-1" />
      ) : (
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="font-bold text-lg text-foreground tracking-tight leading-tight truncate">
          {currentProperty?.name ?? "Uppsolut Stay"}
        </h1>
        {enterpriseName && <p className="hidden sm:block text-xs text-muted-foreground leading-tight truncate">{enterpriseName}</p>}
        {/* Phones: the business date (hidden from the header's right side below sm) is
            the more useful second line than the enterprise name. */}
        <HeaderBusinessDateLine />
      </div>
    </div>
  )
}

// The active property's operational business date, shown on the right of the header.
/** The business date as the brand block's second line — phones only. */
function HeaderBusinessDateLine() {
  const { currentProperty } = useProperty()
  if (!currentProperty?.businessDate) return null
  const label = new Date(currentProperty.businessDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
  return <p className="sm:hidden text-xs text-muted-foreground leading-tight truncate">Business date {label}</p>
}

export function HeaderBusinessDate() {
  const { currentProperty } = useProperty()
  if (!currentProperty?.businessDate) return null

  const label = new Date(currentProperty.businessDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })

  return (
    <div className="hidden sm:flex items-center gap-2 text-sm font-medium text-foreground">
      <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
      {label}
    </div>
  )
}
