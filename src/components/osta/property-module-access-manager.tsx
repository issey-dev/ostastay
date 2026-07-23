"use client"

import { useState, useEffect, useCallback } from "react"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { MODULES, MODULE_LABELS } from "@/lib/modules"

type PropertyModuleRow = { module: string; enabled: boolean }

// Modules that are never sold as a per-property add-on — core operational modules a
// property already gets through its enterprise's own RBAC/licensing, plus the two that
// are never gated at all (see the ALWAYS_LICENSED set in src/lib/scope.ts). Only
// modules genuinely built as opt-in add-ons (today: EXCURSIONS, SPA) belong here —
// this list grows one entry at a time as new add-ons ship, never by removing the
// exclusion.
const ADD_ON_MODULES = MODULES.filter((m) => m === "EXCURSIONS" || m === "SPA")

// The property-scoped sibling of LicensingManager's enterprise-module-override card —
// see /api/licenses/property-modules. Simpler than the enterprise version: there is no
// tier-default fallback to fall back to, a missing row always means "not purchased," so
// each add-on is a plain on/off Switch rather than a three-way override.
export function PropertyModuleAccessManager({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const [rows, setRows] = useState<PropertyModuleRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/licenses/property-modules?propertyId=${propertyId}`)
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }, [propertyId])

  useEffect(() => { fetchRows() }, [fetchRows])

  const toggle = async (module: string, enabled: boolean) => {
    setRows((prev) => prev.map((r) => (r.module === module ? { ...r, enabled } : r)))
    await fetch("/api/licenses/property-modules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, module, enabled }),
    })
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading add-ons...</div>

  if (ADD_ON_MODULES.length === 0) {
    return <p className="text-sm text-muted-foreground">No sellable add-ons exist yet.</p>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Add-ons — {propertyName}</CardTitle>
        <CardDescription>
          Sold and enabled per property, independent of the enterprise&apos;s own license/tier. Off by default for every
          property — a missing toggle here means it was never purchased.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
          {ADD_ON_MODULES.map((module) => {
            const row = rows.find((r) => r.module === module)
            return (
              <div key={module} className="flex items-center justify-between border-b pb-2">
                <span className="text-sm">{MODULE_LABELS[module]}</span>
                <div className="flex items-center gap-2">
                  {row?.enabled ? (
                    <Badge variant="secondary" className="bg-success-muted text-success">Enabled</Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-muted text-muted-foreground">Not purchased</Badge>
                  )}
                  <Switch checked={row?.enabled ?? false} onCheckedChange={(checked) => toggle(module, !!checked)} />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
