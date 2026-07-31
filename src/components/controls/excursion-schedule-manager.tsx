"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { DatePicker } from "@/components/ui/date-picker"
import { Plus, Trash2, Pencil, X } from "@/components/icons"
import { DAYS_OF_WEEK } from "@/lib/excursions"
import type { ExcursionTypeDto, ExcursionScheduleDto } from "@/components/controls/excursions-manager"

const emptyForm = { daysOfWeek: [] as string[], departureTime: "", meetingTime: "", meetingPoint: "", capacity: "", minCapacity: "" }

// Nested inside ExcursionsManager's "Schedule" dialog for one ExcursionType — manages
// its recurring templates (ExcursionSchedule) and the "generate departures" action that
// expands them into bookable ExcursionDeparture rows. See EXCURSIONS_PLAN.md's "hybrid"
// scheduling model: this screen only ever touches templates, never a specific booking.
export function ExcursionScheduleManager({
  excursionType,
  onChanged,
}: {
  excursionType: ExcursionTypeDto
  onChanged: () => void
}) {
  const [form, setForm] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [generateThrough, setGenerateThrough] = useState<string>("")
  const [generating, setGenerating] = useState(false)
  const [generateResult, setGenerateResult] = useState<string | null>(null)

  const toggleDay = (day: string) => {
    setForm((p) => ({
      ...p,
      daysOfWeek: p.daysOfWeek.includes(day) ? p.daysOfWeek.filter((d) => d !== day) : [...p.daysOfWeek, day],
    }))
  }

  const startEdit = (s: ExcursionScheduleDto) => {
    setError(null)
    setEditingId(s.id)
    setForm({
      daysOfWeek: s.daysOfWeek.split(","),
      departureTime: s.departureTime,
      meetingTime: s.meetingTime ?? "",
      meetingPoint: s.meetingPoint ?? "",
      capacity: String(s.capacity),
      minCapacity: s.minCapacity != null ? String(s.minCapacity) : "",
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(emptyForm)
    setError(null)
  }

  const saveSchedule = async () => {
    setError(null)
    if (form.daysOfWeek.length === 0) return setError("Select at least one day of the week")
    if (!form.departureTime) return setError("Departure time is required")
    if (!form.capacity) return setError("Capacity is required")

    setSubmitting(true)
    try {
      const payload = {
        daysOfWeek: form.daysOfWeek.join(","),
        departureTime: form.departureTime,
        meetingTime: form.meetingTime,
        meetingPoint: form.meetingPoint,
        capacity: form.capacity,
        minCapacity: form.minCapacity,
      }
      const res = editingId
        ? await fetch(`/api/excursions/schedules/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/excursions/schedules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ excursionTypeId: excursionType.id, ...payload }),
          })
      if (res.ok) {
        setForm(emptyForm)
        setEditingId(null)
        onChanged()
      } else {
        const body = await res.json().catch(() => null)
        setError(body?.error || `Failed to ${editingId ? "update" : "add"} schedule`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const deleteSchedule = async (id: string) => {
    await fetch(`/api/excursions/schedules/${id}`, { method: "DELETE" })
    if (editingId === id) cancelEdit()
    onChanged()
  }

  const generateDepartures = async () => {
    if (!generateThrough) return
    setGenerating(true)
    setGenerateResult(null)
    try {
      const res = await fetch("/api/excursions/schedules/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excursionTypeId: excursionType.id, through: generateThrough }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok) {
        setGenerateResult(`Created ${data.created} new departure(s) (${data.skipped} already existed).`)
      } else {
        setGenerateResult(data?.error || "Failed to generate departures")
      }
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      <DialogHeader>
        <DialogTitle>Schedule — {excursionType.name}</DialogTitle>
        <DialogDescription>
          Recurring templates expand into bookable departures via &quot;Generate Departures&quot; below. You can also
          add or cancel an individual departure by hand later from the Excursions booking screen.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        {excursionType.schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recurring schedules yet — add one below.</p>
        ) : (
          excursionType.schedules.map((s: ExcursionScheduleDto) => (
            <div key={s.id} className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="text-sm font-medium">{s.daysOfWeek.split(",").join(", ")} at {s.departureTime}</p>
                <p className="text-xs text-muted-foreground">
                  Capacity {s.capacity}{s.minCapacity ? ` (min ${s.minCapacity})` : ""}
                  {s.meetingPoint && ` · Meet at ${s.meetingPoint}${s.meetingTime ? ` (${s.meetingTime})` : ""}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!s.isActive && <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                <Button variant="ghost" size="icon" aria-label="Edit schedule" onClick={() => startEdit(s)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Delete schedule" className="text-destructive hover:text-destructive" onClick={() => deleteSchedule(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{editingId ? "Edit recurring schedule" : "Add a recurring schedule"}</Label>
          {editingId && (
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit} className="h-auto py-1 px-2 text-xs text-muted-foreground">
              <X className="h-3.5 w-3.5 mr-1" /> Cancel
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DAYS_OF_WEEK.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`px-2.5 py-1 rounded-none text-xs font-medium border ${
                form.daysOfWeek.includes(day) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {day}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input type="time" placeholder="Departure time" value={form.departureTime} onChange={(e) => setForm((p) => ({ ...p, departureTime: e.target.value }))} />
          <Input type="time" placeholder="Meeting time (optional)" value={form.meetingTime} onChange={(e) => setForm((p) => ({ ...p, meetingTime: e.target.value }))} />
        </div>
        <Input placeholder="Meeting point (optional, e.g. Main Jetty)" value={form.meetingPoint} onChange={(e) => setForm((p) => ({ ...p, meetingPoint: e.target.value }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input type="number" min="1" placeholder="Capacity" value={form.capacity} onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))} />
          <Input type="number" min="0" placeholder="Min. headcount to run (optional)" value={form.minCapacity} onChange={(e) => setForm((p) => ({ ...p, minCapacity: e.target.value }))} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" onClick={saveSchedule} disabled={submitting} className="w-full">
          {editingId ? (
            submitting ? "Saving..." : "Save Changes"
          ) : (
            <>
              <Plus className="h-4 w-4 mr-1.5" /> {submitting ? "Adding..." : "Add Schedule"}
            </>
          )}
        </Button>
      </div>

      <div className="border rounded-lg p-4 space-y-3">
        <Label className="text-sm font-medium">Generate departures</Label>
        <p className="text-xs text-muted-foreground">
          Expands every active schedule above into bookable dates from today through the date you choose. Safe to
          re-run — dates that already have a departure (generated or hand-edited) are never duplicated or overwritten.
        </p>
        <div className="flex gap-2">
          <div className="flex-1">
            <DatePicker value={generateThrough} onChange={(v) => setGenerateThrough(v ?? "")} placeholder="Through date" />
          </div>
          <Button type="button" onClick={generateDepartures} disabled={generating || !generateThrough}>
            {generating ? "Generating..." : "Generate"}
          </Button>
        </div>
        {generateResult && <p className="text-sm text-muted-foreground">{generateResult}</p>}
      </div>
    </div>
  )
}
