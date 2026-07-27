"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useProperty } from "@/components/providers/property-provider"

// Controls > Excursions > Excursion Settings. Currently just the optional module-level
// Outlet link — mirrors the "Spa Outlet" picker in SpaSettingsForm.
export function ExcursionSettingsForm() {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [outletId, setOutletId] = useState("")

  useEffect(() => {
    if (!propertyId) return
    fetch(`/api/outlets?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setOutlets(data.filter((o: any) => o.isActive)) })
      .catch(() => {})
  }, [propertyId])

  useEffect(() => {
    if (!propertyId) return
    setLoading(true)
    fetch(`/api/excursions/settings?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => setOutletId(data?.outletId ?? ""))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [propertyId])

  const onSave = async () => {
    setSaving(true)
    setServerError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/excursions/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, outletId: outletId || null }),
      })
      if (res.ok) {
        setSaved(true)
      } else {
        const body = await res.json().catch(() => null)
        setServerError(body?.error || "Failed to save settings")
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton className="h-10 w-full max-w-md" />

  return (
    <div className="space-y-4">
      <div className="max-w-md space-y-2">
        <Label>Excursion Outlet <span className="font-normal text-muted-foreground">(optional)</span></Label>
        <Select value={outletId || "none"} onValueChange={(v) => setOutletId(v === "none" ? "" : (v ?? ""))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None — post under each excursion&apos;s own charge code</SelectItem>
            {outlets.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          When linked, excursion charges post through this outlet — attributing the revenue to it and
          applying the outlet&apos;s Tax Rule.
        </p>
      </div>

      {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      {saved && !serverError && <p className="text-sm text-success">Settings saved.</p>}

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
      </div>
    </div>
  )
}
