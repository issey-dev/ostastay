"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Save } from "@/components/icons"
import { useRouter } from "next/navigation"
import { PropertyLogoUploader } from "@/components/controls/property-logo-uploader"

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
        // Only the fields this form edits — the property's tax basis (Finance), check-in rule
        // (Rooms & Inventory) and Night Audit settings are saved on their own pages, and
        // sending the stale copies loaded here would overwrite a change made there.
        body: JSON.stringify({
          name: detail.name, code: detail.code, legalName: detail.legalName,
          checkInTime: detail.checkInTime, checkOutTime: detail.checkOutTime,
          taxId: detail.taxId, contactPhone: detail.contactPhone,
          contactEmail: detail.contactEmail, address: detail.address, starRating: detail.starRating,
        }),
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
      {/* Saved on its own the moment it's uploaded — not by "Save Property". */}
      <PropertyLogoUploader
        propertyId={detail.id}
        logoUrl={detail.logoUrl}
        onChange={(logoUrl) => {
          setDetail({ ...detail, logoUrl })
          // The header and band show the logo — refresh them.
          router.refresh()
        }}
      />
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

      <div className="flex items-center gap-3 justify-end pt-4 border-t">
        {savedMsg && <span className="text-sm text-success">Saved</span>}
        <Button type="submit" disabled={saving}>
          <Save className="w-4 h-4 mr-2" /> {saving ? "Saving..." : "Save Property"}
        </Button>
      </div>
    </form>
  )
}
