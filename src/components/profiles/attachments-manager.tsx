"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2, ExternalLink } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ErrorState } from "@/components/ui/error-state"

type Attachment = { id: string; label: string; url: string; createdAt: string }

// A clickable URL-reference list, not a file-upload system (owner-confirmed) — see
// .agents/docs/PROFILES_REDESIGN_PLAN.md "Attachments".
export function AttachmentsManager({ upid }: { upid: string }) {
  const [rows, setRows] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [label, setLabel] = useState("")
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchRows = () => {
    setLoading(true)
    setLoadError(false)
    fetch(`/api/profiles/${upid}/attachments`)
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
    if (!label.trim() || !url.trim()) {
      setError("Label and URL are both required")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/profiles/${upid}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), url: url.trim() }),
      })
      if (res.ok) {
        setLabel("")
        setUrl("")
        fetchRows()
      } else {
        const body = await res.json().catch(() => null)
        setError(body?.error || "Failed to add")
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/profiles/${upid}/attachments/${id}`, { method: "DELETE" })
    fetchRows()
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : loadError ? (
        <ErrorState title="Couldn't load attachments" onRetry={fetchRows} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No attachments linked yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center gap-1.5 text-sm text-info hover:underline truncate">
                {r.label} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
              <span className="text-xs text-muted-foreground shrink-0">{new Date(r.createdAt).toLocaleDateString()}</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={() => handleDelete(r.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <Input placeholder="Label (e.g. Passport scan)" value={label} onChange={(e) => setLabel(e.target.value)} className="w-48" />
        <Input placeholder="https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button type="button" variant="outline" onClick={handleAdd} disabled={saving}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
