"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangle, CheckCircle2 } from "@/components/icons"

type OutletOption = { id: string; name: string }

// A property's module Outlet link: the one of ITS OWN outlets that this property's Spa /
// Excursion charges post through (per property since 2026-09-23 — it used to be one
// outlet for the whole enterprise). While unlinked, folio posting from the module at this
// property is refused — hence the warning, not a quiet "(optional)".
export function ModuleOutletPicker({ propertyId, module }: { propertyId: string; module: "SPA" | "EXCURSIONS" }) {
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
    fetch(`/api/module-outlets?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => {
        setOutlets(Array.isArray(data.outlets) ? data.outlets : [])
        setOutletId(data[field] ?? "")
        setSavedOutletId(data[field] ?? "")
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [field, propertyId])

  useEffect(() => { refetch() }, [refetch])

  const onSave = async () => {
    setSaving(true)
    setServerError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/module-outlets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, module, outletId: outletId || null }),
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
        <Label>{moduleLabel} Outlet <span className="font-normal text-muted-foreground">— this property only</span></Label>
        <SearchableSelect
          value={outletId}
          onChange={(v) => setOutletId(v ?? "")}
          placeholder="Select an outlet…"
          options={outlets.map((o) => ({ value: o.id, label: o.name }))}
        />
        <p className="text-xs text-muted-foreground">
          One of this property&apos;s own outlets. Every {moduleLabel.toLowerCase()} charge at this
          property posts through it — attributing the revenue to it and applying its Tax Rule.
          Each property links its own; other properties are not affected.
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
          {(() => { const o = outlets.find((x) => x.id === savedOutletId); return o ? o.name : "the selected outlet" })()}.
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
