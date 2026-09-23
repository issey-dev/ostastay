"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OptionSelect } from "@/components/ui/option-select"
import { Save } from "@/components/icons"
import { Switch } from "@/components/ui/switch"
import { useRouter } from "next/navigation"

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

// Edits ONE property's own profile (name, code, times, logo, contact info) — the property
// named by the Hub page it sits on. Deliberately never shows or accepts an enterprise
// selector, so a property can never be reassigned to a different enterprise from here.
export function PropertyProfileManager({ propertyId }: { propertyId: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState<PropertyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/properties")
      if (res.ok) {
        const list: PropertyDetail[] = await res.json()
        setDetail(list.find((p) => p.id === propertyId) ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [propertyId])

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
        // The band and sidebar name this property — refresh them if the name changed.
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading property...</div>
  if (!detail) return <div className="py-8 text-center text-muted-foreground">No property found. Create one under Inventory first.</div>

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
        <div className="space-y-2 md:col-span-2">
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

      <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Label htmlFor="pricesIncludeTaxes">Prices Include Taxes</Label>
          <p className="text-xs text-muted-foreground">
            Top-level default for this property, applied to anything charged. On: Green Tax/GST/Service Charge are
            reverse-calculated out of the posted amount. Off: taxes are added on top. (A future transaction-level
            override is not available yet.)
          </p>
        </div>
        <Switch
          id="pricesIncludeTaxes"
          className="shrink-0"
          checked={detail.pricesIncludeTaxes}
          onCheckedChange={(checked) => setDetail({ ...detail, pricesIncludeTaxes: !!checked })}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Label htmlFor="requireInspectionOnCheckIn">Require Inspected Room at Check-In</Label>
          <p className="text-xs text-muted-foreground">
            On: guests can only be checked into rooms housekeeping has marked Inspected — a supervisor must sign off
            each room before an arrival. Off: a dirty room warns but doesn&apos;t block.
          </p>
        </div>
        <Switch
          id="requireInspectionOnCheckIn"
          className="shrink-0"
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
        <OptionSelect
          id="eodHousekeepingMode"
          value={detail.eodHousekeepingMode}
          options={[
            { label: "Off — don't change statuses", value: "OFF" },
            { label: "Move one status down (Inspected → Clean, Clean → Dirty, Dirty stays)", value: "STEP_DOWN" },
            { label: "Set all vacant rooms to a specific status…", value: "SET_STATUS" },
          ]}
          onChange={(mode) => {
            setDetail({
              ...detail,
              eodHousekeepingMode: mode,
              // Default a target the moment SET_STATUS is chosen so the form is never
              // in an invalid (SET_STATUS + no target) state; clear it otherwise.
              eodHousekeepingTargetStatus:
                mode === "SET_STATUS" ? (detail.eodHousekeepingTargetStatus ?? "DIRTY") : null,
            })
          }}
        />
        {detail.eodHousekeepingMode === "SET_STATUS" && (
          <div className="space-y-1">
            <Label htmlFor="eodHousekeepingTargetStatus" className="text-xs">Target status for vacant rooms</Label>
            <OptionSelect
              id="eodHousekeepingTargetStatus"
              value={detail.eodHousekeepingTargetStatus ?? "DIRTY"}
              onChange={(v) => setDetail({ ...detail, eodHousekeepingTargetStatus: v })}
              options={[
                { label: "Clean", value: "CLEAN" },
                { label: "Dirty", value: "DIRTY" },
                { label: "Inspected", value: "INSPECTED" },
              ]}
            />
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
