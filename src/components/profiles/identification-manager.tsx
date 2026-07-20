"use client"

import { useEffect, useState } from "react"
import { Plus, Star, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { SystemCodeSelect } from "@/components/ui/system-code-select"
import { DatePicker } from "@/components/ui/date-picker"
import { cn } from "@/lib/utils"

type ProfileDocument = {
  id: string
  documentType: string
  documentNumber: string
  issuingCountry: string | null
  expiryDate: string | null
  isPrimary: boolean
}

const emptyForm = { documentType: "", documentNumber: "", issuingCountry: "", expiryDate: "" }

// Multiple per profile, one may be marked primary — see
// .agents/docs/PROFILES_REDESIGN_PLAN.md "Identification". Upgraded off the old
// destructive single-document replace-all onto real per-row CRUD.
export function IdentificationManager({ upid }: { upid: string }) {
  const [rows, setRows] = useState<ProfileDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(emptyForm)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchRows = () => {
    setLoading(true)
    fetch(`/api/profiles/${upid}/documents`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setRows(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRows() }, [upid]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    setError(null)
    if (!form.documentType || !form.documentNumber.trim()) {
      setError("Document type and number are required")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/profiles/${upid}/documents`, {
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
    await fetch(`/api/profiles/${upid}/documents/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPrimary: true }),
    })
    fetchRows()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/profiles/${upid}/documents/${id}`, { method: "DELETE" })
    fetchRows()
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No identification documents on file yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Badge variant="outline" className="shrink-0">{r.documentType}</Badge>
              <span className="flex-1 text-sm truncate">
                {r.documentNumber}
                {r.issuingCountry && <span className="text-muted-foreground"> · {r.issuingCountry}</span>}
                {r.expiryDate && <span className="text-muted-foreground"> · exp. {new Date(r.expiryDate).toLocaleDateString()}</span>}
              </span>
              <button
                type="button"
                title={r.isPrimary ? "Primary" : "Set as primary"}
                onClick={() => !r.isPrimary && handleSetPrimary(r.id)}
                className={cn("shrink-0", r.isPrimary ? "text-warning" : "text-muted-foreground hover:text-foreground")}
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
              <Label className="text-xs">Document Type</Label>
              <SystemCodeSelect category="ID_TYPE" value={form.documentType} onValueChange={(v) => setForm((p) => ({ ...p, documentType: v }))} placeholder="Select type" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Document Number</Label>
              <Input placeholder="e.g. AB123456" value={form.documentNumber} onChange={(e) => setForm((p) => ({ ...p, documentNumber: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Issued Country</Label>
              <SystemCodeSelect category="NATIONALITY" value={form.issuingCountry} onValueChange={(v) => setForm((p) => ({ ...p, issuingCountry: v }))} placeholder="Select country" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Expiry Date</Label>
              <DatePicker value={form.expiryDate} onChange={(v) => setForm((p) => ({ ...p, expiryDate: v }))} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setAdding(false); setForm(emptyForm); setError(null) }}>Cancel</Button>
            <Button type="button" size="sm" onClick={handleAdd} disabled={saving}>{saving ? "Saving..." : "Add Document"}</Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Document
        </Button>
      )}
    </div>
  )
}
