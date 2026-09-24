"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { SearchableSelect } from "@/components/ui/searchable-select"
import type { HubProperty } from "@/lib/hub-properties"

// The band across the top of every property page in the Hub:
//   "Configuring · Veyo Lagoon Retreat"  [switch property ▾]
// It is the answer to "which property am I changing?" and is never optional on a
// property page (see .agents/docs/HUB_SETUP_PLAN.md).
//
// The property's banner colour is an ACCENT (edge + dot), never the band's fill: some
// property colours would leave the text unreadable, which is why the dashboard's own
// banner is an accent line too (src/components/ui/property-banner-bar.tsx).
//
// Switching keeps you in the same section — configuring Outlets at Beach Resort and
// switching to Lagoon Retreat lands on Lagoon Retreat's Outlets.
export function HubPropertyBand({
  slug,
  property,
  properties,
  cookieName,
}: {
  slug: string
  property: HubProperty
  properties: HubProperty[]
  cookieName: string
}) {
  const pathname = usePathname() ?? ""
  const router = useRouter()

  // Remember this as the property the Hub opens next time (a UX default only — see
  // resolveHubPropertyId). Never the dashboard's working-property cookie.
  useEffect(() => {
    document.cookie = `${cookieName}=${property.id}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`
  }, [cookieName, property.id])

  const prefix = `/e/${slug}/hub/p/${property.id}`
  const switchTo = (id: string) => {
    if (!id || id === property.id) return
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ""
    router.push(`/e/${slug}/hub/p/${id}${rest}`)
  }

  const accent = property.bannerColor ?? "var(--primary)"

  return (
    <div
      data-slot="hub-property-band"
      className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-l-4 bg-card px-4 py-3 shadow-elevation-1"
      style={{ borderLeftColor: accent }}
    >
      <span aria-hidden className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Configuring</p>
        <p className="truncate text-base font-semibold leading-tight text-foreground">
          {property.name}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">{property.code}</span>
        </p>
      </div>
      {properties.length > 1 && (
        <div className="w-full sm:w-64">
          <SearchableSelect
            value={property.id}
            onChange={switchTo}
            placeholder="Switch property…"
            searchPlaceholder="Search properties…"
            options={properties.map((p) => ({ label: p.name, value: p.id }))}
          />
        </div>
      )}
    </div>
  )
}
