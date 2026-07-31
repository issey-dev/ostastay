"use client"

import { useEffect, useState } from "react"
import { Plus, Star, Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { ErrorState } from "@/components/ui/error-state"
import { cn } from "@/lib/utils"

type Communication = { id: string; type: string; value: string; isPrimary: boolean }

const TYPE_LABELS: Record<string, string> = { EMAIL: "Email", MOBILE: "Mobile", SOCIAL: "Social" }
const TYPE_PLACEHOLDERS: Record<string, string> = {
  EMAIL: "name@example.com",
  MOBILE: "+960 555 0100",
  SOCIAL: "@handle or profile URL",
}

// Multiple per profile, one may be marked primary — see
// .agents/docs/PROFILES_REDESIGN_PLAN.md "Communications". Each row saves immediately
// via its own endpoint (no batched form submit), matching the real per-row CRUD
// architecture the redesign moved to.
export function CommunicationsManager({ upid }: { upid: string }) {
  const [rows, setRows] = useState<Communication[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [newType, setNewType] = useState("EMAIL")
  const [newValue, setNewValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchRows = () => {
    setLoading(true)
    setLoadError(false)
    fetch(`/api/profiles/${upid}/communications`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => { if (Array.isArray(data)) setRows(data) })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchRows() }, [upid]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    setError(null)
    if (!newValue.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/profiles/${upid}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: newType, value: newValue.trim(), isPrimary: rows.length === 0 }),
      })
      if (res.ok) {
        setNewValue("")
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
    await fetch(`/api/profiles/${upid}/communications/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPrimary: true }),
    })
    fetchRows()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/profiles/${upid}/communications/${id}`, { method: "DELETE" })
    fetchRows()
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : loadError ? (
        <ErrorState title="Couldn't load communications" onRetry={fetchRows} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No communications on file yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Badge variant="outline" className="shrink-0">{TYPE_LABELS[r.type] ?? r.type}</Badge>
              <span className="flex-1 text-sm truncate">{r.value}</span>
              <button
                type="button"
                title={r.isPrimary ? "Primary" : "Set as primary"}
                onClick={() => !r.isPrimary && handleSetPrimary(r.id)}
                className={cn("shrink-0", r.isPrimary ? "text-warning" : "text-muted-foreground hover:text-foreground")}
              >
                <Star className={cn("h-4 w-4", r.isPrimary && "fill-current")} />
              </button>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => handleDelete(r.id)} aria-label="Delete contact">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-start pt-1">
        <Select value={newType} onValueChange={(v) => setNewType(v ?? "EMAIL")}>
          <SelectTrigger className="w-32 shrink-0"><SelectValue>{TYPE_LABELS[newType]}</SelectValue></SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder={TYPE_PLACEHOLDERS[newType]}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd() } }}
        />
        <Button type="button" variant="outline" onClick={handleAdd} disabled={saving || !newValue.trim()}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
