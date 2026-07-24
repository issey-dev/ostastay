"use client"

import { useEffect, useState } from "react"
import { Pin, PinOff, Trash2, Send } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"

type Note = { id: string; noteText: string; isPinned: boolean; createdAt: string; authorName: string }

// A running, dated log to review feedback/complaints/notable guest-specific things —
// see .agents/docs/PROFILES_REDESIGN_PLAN.md "Notes". Wires up the previously-dead
// ProfileNote model.
export function NotesPanel({ upid }: { upid: string }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)

  const fetchNotes = () => {
    setLoading(true)
    fetch(`/api/profiles/${upid}/notes`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setNotes(data) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchNotes() }, [upid]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!text.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/profiles/${upid}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText: text.trim() }),
      })
      if (res.ok) {
        setText("")
        fetchNotes()
      }
    } finally {
      setSaving(false)
    }
  }

  const togglePin = async (note: Note) => {
    await fetch(`/api/profiles/${upid}/notes/${note.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned: !note.isPinned }),
    })
    fetchNotes()
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/profiles/${upid}/notes/${id}`, { method: "DELETE" })
    fetchNotes()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Textarea
          placeholder="Add a note — feedback, complaints, anything notable about this guest..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          className="flex-1"
        />
        <Button type="button" variant="outline" onClick={handleAdd} disabled={saving || !text.trim()} className="self-end">
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No notes yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-md border px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm whitespace-pre-wrap flex-1">{n.noteText}</p>
                <div className="flex items-center gap-1 shrink-0">
                  {n.isPinned && <Badge variant="outline" className="bg-warning-muted text-warning border-warning/30">Pinned</Badge>}
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => togglePin(n)}>
                    {n.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(n.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {n.authorName} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
