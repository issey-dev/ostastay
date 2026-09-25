"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useProperty } from "@/components/providers/property-provider"
import { Building2, CalendarClock, Check, ChevronsUpDown, Loader2, Settings } from "@/components/icons"
import { LogoTile } from "@/components/ui/logo-tile"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// The header brand block: the active property's logo + name, with the enterprise
// name beneath. Property data is client-side (PropertyProvider) so it updates on a
// property switch; the enterprise name is stable and passed from the server layout.
// Desktop: when the user can open more than one property, the brand block IS the property
// switcher (DESKTOP_PLAN §2.1 — it used to be two clicks deep in the Account dialog). The
// switch persists server-side, then the app reloads on the new property (same as the menu).
export function HeaderBrand({ enterpriseName }: { enterpriseName: string }) {
  const { currentProperty, properties, isLocked } = useProperty()
  const [switching, setSwitching] = useState<string | null>(null)
  const canSwitch = !isLocked && properties.length > 1

  const handleSwitch = async (id: string) => {
    if (id === currentProperty?.id) return
    setSwitching(id)
    try {
      await fetch("/api/session/current-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: id }),
      })
      window.location.reload()
    } catch {
      setSwitching(null)
    }
  }

  const brand = <BrandBlock enterpriseName={enterpriseName} switchable={canSwitch} />
  if (!canSwitch) return brand
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" className="min-w-0 -mx-2 px-2 py-1 text-left transition-colors hover:bg-muted/60 outline-hidden focus-visible:ring-2 ring-ring" aria-label="Switch property" />}
      >
        {brand}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuGroup>
        <DropdownMenuLabel>Switch property</DropdownMenuLabel>
        {properties.map((p) => (
          <DropdownMenuItem key={p.id} disabled={switching !== null} onClick={() => handleSwitch(p.id)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.bannerColor ?? "var(--muted-foreground)" }} />
            <span className="flex-1 truncate">{p.name}</span>
            {switching === p.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : p.id === currentProperty?.id ? (
              <Check className="h-4 w-4" />
            ) : null}
          </DropdownMenuItem>
        ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BrandBlock({ enterpriseName, switchable }: { enterpriseName: string; switchable: boolean }) {
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
        {/* Not a heading: the page title (PageHeader) is the page's only <h1>. */}
        <p className="flex items-center gap-1.5 font-bold text-lg text-foreground tracking-tight leading-tight">
          <span className="truncate">{currentProperty?.name ?? "Uppsolut Stay"}</span>
          {switchable && <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground max-sm:hidden" />}
        </p>
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
  const { slug } = useParams<{ slug: string }>()
  if (!currentProperty?.businessDate) return null

  const label = new Date(currentProperty.businessDate).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })

  // Links to Night Audit — the business date is where End of Day moves it on.
  return (
    <Link
      href={`/e/${slug}/dashboard/financials/night-audit`}
      title="Business date — open Night Audit"
      className="hidden sm:flex items-center gap-2 text-sm font-medium text-foreground hover:underline"
    >
      <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
      {label}
    </Link>
  )
}

/** "Setup" — the way into the Hub, shown only to users with Hub access. */
export function HeaderSetupLink({ href }: { href?: string }) {
  if (!href) return null
  return (
    <a href={href} className="max-md:hidden" title="Setup and administration (Hub)">
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
        <Settings className="h-4 w-4" /> Setup
      </Button>
    </a>
  )
}
