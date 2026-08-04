"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useProperty } from "@/components/providers/property-provider"

// The one user-related control that stays in Controls: how long a terminal at THIS
// property may sit idle before its session ends.
//
// It belongs here rather than in the Hub because it is genuinely per-property — a busy
// front desk in a shared lobby wants a short timeout, a back-office machine doesn't.
// Everything else about users (who exists, what they may do, who is signed in) moved to
// the Hub on 2026-08-04, because identity is enterprise-wide.

// lastSeenAt is stamped at most once a minute, so anything under 5 minutes would sign
// people out unpredictably rather than promptly. The server enforces the same floor.
const MIN_MINUTES = 5

const PRESETS = [
  { minutes: 0, label: "Off" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
]

export function SessionTimeoutManager() {
  const { currentProperty, refreshProperties } = useProperty()
  const [minutes, setMinutes] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (currentProperty) setMinutes(currentProperty.sessionIdleMinutes ?? 0)
  }, [currentProperty])

  const save = async (next: number) => {
    if (!currentProperty) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/properties/${currentProperty.id}`, {
        // PUT, not PATCH — this route only exports PUT, and a PATCH silently 405s.
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIdleMinutes: next }),
      })
      if (res.ok) {
        const saved = await res.json()
        setMinutes(saved.sessionIdleMinutes ?? next)
        setMessage(
          (saved.sessionIdleMinutes ?? next) === 0
            ? "Idle timeout is off — sessions last until sign-out, End of Day, or 24 hours."
            : `Sessions at this property now end after ${saved.sessionIdleMinutes} minutes of inactivity.`
        )
        refreshProperties()
      } else {
        setMessage("Couldn't save the timeout.")
      }
    } catch {
      setMessage("Couldn't save the timeout.")
    } finally {
      setSaving(false)
    }
  }

  if (minutes === null) return <Skeleton className="h-28 w-full rounded-lg" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.minutes}
            variant={minutes === p.minutes ? "default" : "outline"}
            size="sm"
            disabled={saving}
            onClick={() => save(p.minutes)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="idle-minutes">Custom (minutes)</Label>
          <Input
            id="idle-minutes"
            type="number"
            min={MIN_MINUTES}
            step={5}
            className="w-32"
            value={minutes === 0 ? "" : minutes}
            placeholder="Off"
            onChange={(e) => setMinutes(Number(e.target.value) || 0)}
          />
        </div>
        <Button variant="outline" disabled={saving} onClick={() => save(minutes)}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Minimum {MIN_MINUTES} minutes — activity is recorded at most once a minute, so a
        tighter setting would sign people out unpredictably rather than promptly. A person
        is signed out somewhere between the timeout and a minute after it. Set it to Off to
        keep today&apos;s behaviour, where a session lasts until sign-out, End of Day, or 24
        hours.
      </p>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
