"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Save } from "@/components/icons"
import { Switch } from "@/components/ui/switch"
import { useProperty } from "@/components/providers/property-provider"

type PropertyDetail = {
  id: string
  name: string
  code: string
  legalName: string
  defaultCurrency: string
  timeZone: string
  checkInTime: string
  checkOutTime: string
  logoUrl: string | null
  taxId: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  starRating: number | null
  stationeryFont: string | null
  pricesIncludeTaxes: boolean
  requireInspectionOnCheckIn: boolean
  eodHousekeepingMode: string
  eodHousekeepingTargetStatus: string | null
}

// Edits the CURRENT property's own profile directly (name, code, times, logo, contact
// info) — deliberately never shows or accepts an enterprise selector, so a property can
// never be reassigned to a different enterprise from here.
export function PropertyProfileManager() {
  const { currentProperty } = useProperty()
  const [detail, setDetail] = useState<PropertyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

  const fetchDetail = useCallback(async () => {
    if (!currentProperty) return
    setLoading(true)
    try {
      const res = await fetch("/api/properties")
      if (res.ok) {
        const list: PropertyDetail[] = await res.json()
        setDetail(list.find((p) => p.id === currentProperty.id) ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [currentProperty])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail) return
    setSaving(true)
    setSavedMsg(false)
    try {
      const res = await fetch(`/api/properties/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detail),
      })
      if (res.ok) {
        setSavedMsg(true)
        setTimeout(() => setSavedMsg(false), 3000)
      }
    } finally {
      setSaving(false)
    }
  }

  if (!currentProperty || loading) return <div className="py-8 text-center text-muted-foreground">Loading property...</div>
  if (!detail) return <div className="py-8 text-center text-muted-foreground">No property found. Create one under Inventory first.</div>

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Property Name</Label>
          <Input value={detail.name} onChange={(e) => setDetail({ ...detail, name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Legal Name</Label>
          <Input value={detail.legalName} onChange={(e) => setDetail({ ...detail, legalName: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Short Code</Label>
          <Input value={detail.code} onChange={(e) => setDetail({ ...detail, code: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Star Rating</Label>
          <Input type="number" min={0} max={5} value={detail.starRating ?? ""} onChange={(e) => setDetail({ ...detail, starRating: e.target.value ? parseInt(e.target.value) : null })} />
        </div>
        <div className="space-y-2">
          <Label>Check-in Time</Label>
          <Input value={detail.checkInTime} onChange={(e) => setDetail({ ...detail, checkInTime: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Check-out Time</Label>
          <Input value={detail.checkOutTime} onChange={(e) => setDetail({ ...detail, checkOutTime: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Logo URL</Label>
          <Input placeholder="https://…" value={detail.logoUrl ?? ""} onChange={(e) => setDetail({ ...detail, logoUrl: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Tax ID</Label>
          <Input value={detail.taxId ?? ""} onChange={(e) => setDetail({ ...detail, taxId: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Contact Phone</Label>
          <Input value={detail.contactPhone ?? ""} onChange={(e) => setDetail({ ...detail, contactPhone: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Contact Email</Label>
          <Input type="email" value={detail.contactEmail ?? ""} onChange={(e) => setDetail({ ...detail, contactEmail: e.target.value })} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Address</Label>
          <Input
            placeholder="e.g. North Male Atoll, Maldives"
            value={detail.address ?? ""}
            onChange={(e) => setDetail({ ...detail, address: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Shown on every printed stationary header (invoices, receipts, letters, registration cards, statements).
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">The enterprise this property belongs to cannot be changed here.</p>

      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <Label htmlFor="pricesIncludeTaxes">Prices Include Taxes</Label>
          <p className="text-xs text-muted-foreground">
            Top-level default for this property, applied to anything charged. On: Green Tax/GST/Service Charge are
            reverse-calculated out of the posted amount. Off: taxes are added on top. (A future transaction-level
            override is not available yet.)
          </p>
        </div>
        <Switch
          id="pricesIncludeTaxes"
          checked={detail.pricesIncludeTaxes}
          onCheckedChange={(checked) => setDetail({ ...detail, pricesIncludeTaxes: !!checked })}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border border-border p-3">
        <div>
          <Label htmlFor="requireInspectionOnCheckIn">Require Inspected Room at Check-In</Label>
          <p className="text-xs text-muted-foreground">
            On: guests can only be checked into rooms housekeeping has marked Inspected — a supervisor must sign off
            each room before an arrival. Off: a dirty room warns but doesn&apos;t block.
          </p>
        </div>
        <Switch
          id="requireInspectionOnCheckIn"
          checked={detail.requireInspectionOnCheckIn}
          onCheckedChange={(checked) => setDetail({ ...detail, requireInspectionOnCheckIn: !!checked })}
        />
      </div>

      <div className="rounded-md border border-border p-3 space-y-3">
        <div>
          <Label htmlFor="eodHousekeepingMode">Night Audit — Auto Room Status</Label>
          <p className="text-xs text-muted-foreground">
            When End-of-Day runs, automatically downgrade housekeeping statuses. Occupied rooms always become Dirty for
            daily service; the rule below applies to <strong>vacant rooms only</strong>. Out-of-Order / Out-of-Service
            rooms are never changed.
          </p>
        </div>
        <select
          id="eodHousekeepingMode"
          className="w-full border-border rounded-md shadow-sm h-10 px-3 border bg-background focus:ring-ring focus:border-ring"
          value={detail.eodHousekeepingMode}
          onChange={(e) => {
            const mode = e.target.value
            setDetail({
              ...detail,
              eodHousekeepingMode: mode,
              // Default a target the moment SET_STATUS is chosen so the form is never
              // in an invalid (SET_STATUS + no target) state; clear it otherwise.
              eodHousekeepingTargetStatus:
                mode === "SET_STATUS" ? (detail.eodHousekeepingTargetStatus ?? "DIRTY") : null,
            })
          }}
        >
          <option value="OFF">Off — don&apos;t change statuses</option>
          <option value="STEP_DOWN">Move one status down (Inspected → Clean, Clean → Dirty, Dirty stays)</option>
          <option value="SET_STATUS">Set all vacant rooms to a specific status…</option>
        </select>
        {detail.eodHousekeepingMode === "SET_STATUS" && (
          <div className="space-y-1">
            <Label htmlFor="eodHousekeepingTargetStatus" className="text-xs">Target status for vacant rooms</Label>
            <select
              id="eodHousekeepingTargetStatus"
              className="w-full border-border rounded-md shadow-sm h-10 px-3 border bg-background focus:ring-ring focus:border-ring"
              value={detail.eodHousekeepingTargetStatus ?? "DIRTY"}
              onChange={(e) => setDetail({ ...detail, eodHousekeepingTargetStatus: e.target.value })}
            >
              <option value="CLEAN">Clean</option>
              <option value="DIRTY">Dirty</option>
              <option value="INSPECTED">Inspected</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 justify-end pt-4 border-t">
        {savedMsg && <span className="text-sm text-success">Saved</span>}
        <Button type="submit" disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Property"}
        </Button>
      </div>
    </form>
  )
}
