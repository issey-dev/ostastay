"use client"

import { useState, useEffect, useCallback } from "react"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { InfoHint } from "@/components/ui/info-hint"
import { MODULES, SERVICE_ADDONS, addonLabel } from "@/lib/modules"

type AddonRow = { module: string; enabled: boolean }

// Modules that are never sold as an add-on — core operational modules an enterprise
// already gets through its own RBAC/licensing, plus the two that are never gated at
// all (see the ALWAYS_LICENSED set in src/lib/scope.ts). Only modules genuinely built
// as opt-in add-ons (today: EXCURSIONS, SPA) belong here — this list grows one entry
// at a time as new add-ons ship, never by removing the exclusion. Must stay in sync
// with the ADD_ON_MODULES set in src/components/app-sidebar.tsx.
// Plus SERVICE_ADDONS — sellable things that are not app modules at all (today:
// PLATFORM_EMAIL, the Uppsolut Mail Service). They share this table and this UI because
// the question is identical: has this enterprise purchased it?
const ADD_ON_MODULES: readonly string[] = [
  ...MODULES.filter((m) => m === "EXCURSIONS" || m === "SPA"),
  ...SERVICE_ADDONS,
]

// Enterprise-scoped since 2026-08-02 (owner decision) — an add-on is sold to the
// enterprise and, once enabled, applies to every property in it. See
// /api/licenses/enterprise-addons. A missing row always means "not purchased," so
// each add-on is a plain on/off Switch.
export function EnterpriseAddonAccessManager({ enterpriseId, enterpriseName }: { enterpriseId: string; enterpriseName: string }) {
  const [rows, setRows] = useState<AddonRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/licenses/enterprise-addons?enterpriseId=${enterpriseId}`)
      if (res.ok) setRows(await res.json())
    } finally {
      setLoading(false)
    }
  }, [enterpriseId])

  useEffect(() => { fetchRows() }, [fetchRows])

  const toggle = async (module: string, enabled: boolean) => {
    setRows((prev) => prev.map((r) => (r.module === module ? { ...r, enabled } : r)))
    await fetch("/api/licenses/enterprise-addons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enterpriseId, module, enabled }),
    })
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading add-ons...</div>

  if (ADD_ON_MODULES.length === 0) {
    return <p className="text-sm text-muted-foreground">No sellable add-ons exist yet.</p>
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">Add-ons — {enterpriseName}
              <InfoHint>Sold and enabled per enterprise, independent of its license/tier — once enabled, the add-on is available to every property in the enterprise. Off by default — a missing toggle here means it was never purchased.</InfoHint>
            </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
          {ADD_ON_MODULES.map((module) => {
            const row = rows.find((r) => r.module === module)
            return (
              <div key={module} className="flex items-center justify-between border-b pb-2">
                <span className="text-sm">{addonLabel(module)}</span>
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
