"use client"

import { useState } from "react"
import { Check, Loader2 } from "@/components/icons"

type Property = { id: string; name: string; bannerColor: string | null }

// The Hub's "leave the enterprise, go work a property" action. Deliberately NOT
// useProperty() — the Hub layout enforces "no PropertyProvider in this tree" (see
// src/app/e/[slug]/hub/layout.tsx), so the property list and the current pick both
// come down as server-rendered props instead of the client-side provider used on the
// property side (src/components/ui/sidebar-user-menu.tsx). Same card styling as that
// component's "Switch property" list, so leaving and entering the Hub feel like the
// same action pointed in opposite directions.
export function HubPropertySwitcher({
  slug,
  properties,
  currentPropertyId,
}: {
  slug: string
  properties: Property[]
  currentPropertyId: string | null
}) {
  const [switching, setSwitching] = useState<string | null>(null)

  const handleSwitch = async (id: string) => {
    setSwitching(id)
    try {
      await fetch("/api/session/current-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: id }),
      })
      window.location.href = `/e/${slug}/dashboard`
    } catch {
      setSwitching(null)
    }
  }

  return (
    <div className="space-y-1.5">
      {properties.map((p) => {
        const active = p.id === currentPropertyId
        return (
          <button
            key={p.id}
            type="button"
            disabled={switching !== null}
            onClick={() => void handleSwitch(p.id)}
            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
              active ? "border-foreground/30 bg-muted" : "border-border hover:bg-muted/60"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: p.bannerColor ?? "var(--muted-foreground)" }}
            />
            <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
            {switching === p.id ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : active ? (
              <Check className="h-4 w-4 text-foreground" />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
