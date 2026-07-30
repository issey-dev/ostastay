"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, CheckCircle2 } from "@/components/icons"

type OutletOption = { id: string; name: string; property: { id: string; name: string } }

// The hub-wide module Outlet link (owner ruling 2026-07-30): one outlet per module,
// shared across every property in the enterprise, selectable from ANY property's
// outlets (cross-property posting is deliberate). While unlinked, folio posting from
// the module is refused — hence the warning, not a quiet "(optional)".
export function ModuleOutletPicker({ module }: { module: "SPA" | "EXCURSIONS" }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [outlets, setOutlets] = useState<OutletOption[]>([])
  const [outletId, setOutletId] = useState("")
  const [savedOutletId, setSavedOutletId] = useState("")

  const moduleLabel = module === "SPA" ? "Spa" : "Excursion"
  const field = module === "SPA" ? "spaOutletId" : "excursionOutletId"

  const refetch = useCallback(() => {
    setLoading(true)
    fetch("/api/module-outlets")
      .then((r) => r.json())
      .then((data) => {
        setOutlets(Array.isArray(data.outlets) ? data.outlets : [])
        setOutletId(data[field] ?? "")
        setSavedOutletId(data[field] ?? "")
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [field])

  useEffect(() => { refetch() }, [refetch])

  const onSave = async () => {
    setSaving(true)
    setServerError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/module-outlets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, outletId: outletId || null }),
      })
      if (res.ok) {
        setSaved(true)
        setSavedOutletId(outletId)
      } else {
        const body = await res.json().catch(() => null)
        setServerError(body?.error || "Failed to save")
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-10 w-full max-w-md" />

  const linked = !!savedOutletId

  return (
    <div className="space-y-3">
      <div className="max-w-md space-y-2">
        <Label>{moduleLabel} Outlet <span className="font-normal text-muted-foreground">— shared across all properties</span></Label>
        <SearchableSelect
          value={outletId}
          onChange={(v) => setOutletId(v ?? "")}
          placeholder="Select an outlet…"
          options={outlets.map((o) => ({ value: o.id, label: `${o.name} — ${o.property.name}` }))}
        />
        <p className="text-xs text-muted-foreground">
          Every {moduleLabel.toLowerCase()} charge, from any property, posts through this outlet —
          attributing the revenue to it and applying its Tax Rule.
        </p>
      </div>

      {!linked ? (
        <p className="flex items-center gap-1.5 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No outlet linked — posting charges from the {moduleLabel} module is blocked until one is selected.
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Linked — {moduleLabel.toLowerCase()} charges post through{" "}
          {(() => { const o = outlets.find((x) => x.id === savedOutletId); return o ? `${o.name} (${o.property.name})` : "the selected outlet" })()}.
        </p>
      )}

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      {saved && !serverError && <p className="text-sm text-success">Settings saved.</p>}

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving || outletId === savedOutletId}>{saving ? "Saving..." : "Save"}</Button>
      </div>
    </div>
  )
}
