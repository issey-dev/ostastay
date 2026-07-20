"use client"

import { useEffect, useState } from "react"
import { Plus, Star, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { SystemCodeSelect } from "@/components/ui/system-code-select"
import { cn } from "@/lib/utils"

type Address = {
  id: string
  type: string
  fullAddress: string
  city: string | null
  stateProvince: string | null
  postalCode: string | null
  country: string | null
  isPrimary: boolean
}

const TYPE_LABELS: Record<string, string> = { HOME: "Home", BUSINESS: "Business", BILLING: "Billing" }

const emptyForm = { type: "HOME", fullAddress: "", city: "", stateProvince: "", postalCode: "", country: "" }

// Multiple per profile, one may be marked primary — see
// .agents/docs/PROFILES_REDESIGN_PLAN.md "Address". fullAddress is one free-text block
// (not street-line-broken) per the app owner's spec.
export function AddressManager({ upid }: { upid: string }) {
  const [rows, setRows] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchRows = () => {
    setLoading(true)
    fetch(`/api/profiles/${upid}/addresses`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setRows(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRows() }, [upid]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    setError(null)
    if (!form.fullAddress.trim()) {
      setError("Full address is required")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/profiles/${upid}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, isPrimary: rows.length === 0 }),
      })
      if (res.ok) {
        setForm(emptyForm)
        setAdding(false)
        fetchRows()
      } else {
        const body = await res.json().catch(() => null)
        setError(body?.error || "Failed to add")
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSetPrimary = async (id: string) => {
    await fetch(`/api/profiles/${upid}/addresses/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPrimary: true }),
    })
    fetchRows()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/profiles/${upid}/addresses/${id}`, { method: "DELETE" })
    fetchRows()
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No addresses on file yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 rounded-md border px-3 py-2">
              <Badge variant="outline" className="shrink-0 mt-0.5">{TYPE_LABELS[r.type] ?? r.type}</Badge>
              <div className="flex-1 text-sm">
                <div>{r.fullAddress}</div>
                <div className="text-muted-foreground text-xs">
                  {[r.city, r.stateProvince, r.postalCode, r.country].filter(Boolean).join(", ")}
                </div>
              </div>
              <button
                type="button"
                title={r.isPrimary ? "Primary" : "Set as primary"}
                onClick={() => !r.isPrimary && handleSetPrimary(r.id)}
                className={cn("shrink-0 mt-0.5", r.isPrimary ? "text-warning" : "text-muted-foreground hover:text-foreground")}
              >
                <Star className={cn("h-4 w-4", r.isPrimary && "fill-current")} />
              </button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => handleDelete(r.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="space-y-3 rounded-md border p-3 bg-muted/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v ?? "HOME" }))}>
                <SelectTrigger><SelectValue>{TYPE_LABELS[form.type]}</SelectValue></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Country</Label>
              <SystemCodeSelect category="NATIONALITY" value={form.country} onValueChange={(v) => setForm((p) => ({ ...p, country: v }))} placeholder="Select country" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">Full Address</Label>
            <Input placeholder="123 Main St, Apt 4B" value={form.fullAddress} onChange={(e) => setForm((p) => ({ ...p, fullAddress: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">City</Label>
              <Input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">State / Province</Label>
              <Input value={form.stateProvince} onChange={(e) => setForm((p) => ({ ...p, stateProvince: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">ZIP</Label>
              <Input value={form.postalCode} onChange={(e) => setForm((p) => ({ ...p, postalCode: e.target.value }))} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setAdding(false); setForm(emptyForm); setError(null) }}>Cancel</Button>
            <Button type="button" size="sm" onClick={handleAdd} disabled={saving}>{saving ? "Saving..." : "Add Address"}</Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Address
        </Button>
      )}
    </div>
  )
}
