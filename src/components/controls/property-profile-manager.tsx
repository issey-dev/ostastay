"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Save } from "lucide-react"
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
  starRating: number | null
  pricesIncludeTaxes: boolean
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

      <div className="flex items-center gap-3 justify-end pt-4 border-t">
        {savedMsg && <span className="text-sm text-success">Saved</span>}
        <Button type="submit" disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Property"}
        </Button>
      </div>
    </form>
  )
}
