"use client"

import { useProperty } from "@/components/providers/property-provider"
import { Building2, CalendarClock } from "@/components/icons"

// The header brand block: the active property's logo + name, with the enterprise
// name beneath. Property data is client-side (PropertyProvider) so it updates on a
// property switch; the enterprise name is stable and passed from the server layout.
export function HeaderBrand({ enterpriseName }: { enterpriseName: string }) {
  const { currentProperty } = useProperty()

  return (
    <div className="flex items-center gap-3 min-w-0">
      {currentProperty?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentProperty.logoUrl} alt="" className="h-9 w-9 rounded-md object-cover shrink-0 shadow-elevation-1" />
      ) : (
        <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0">
        <h1 className="font-bold text-lg text-foreground tracking-tight leading-tight truncate">
          {currentProperty?.name ?? "OstaStay"}
        </h1>
        {enterpriseName && <p className="text-xs text-muted-foreground leading-tight truncate">{enterpriseName}</p>}
      </div>
    </div>
  )
}

// The active property's operational business date, shown on the right of the header.
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
