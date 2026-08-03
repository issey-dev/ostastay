"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Shared building blocks for the two channel-connection screens: the Osta console's
// cross-tenant admin (src/components/osta/channel-connections-admin.tsx) and the tenant
// Hub's READ-ONLY status view (src/components/hub/channel-connection-status.tsx).
//
// These used to live inside the Hub's own manager component, which was the only screen
// that existed. That component was deleted on 2026-08-03 when establishing the Beds24
// link became an Osta-level action — its connect/re-authorize/delete dialogs had no
// tenant-side home left, and the Osta console already has its own.

// Exported for the Osta console's cross-tenant manager
// (src/components/osta/channel-connections-admin.tsx), which renders the same
// per-connection shape with an enterprise attached.
export type Connection = {
  id: string
  provider: string
  name: string
  status: string
  hasCredentials: boolean
  /** Whether an inbound webhook URL exists. The token itself is never in any response. */
  hasWebhook: boolean
  lastTokenRefreshAt: string | null
  lastHealthCheckAt: string | null
  lastError: string | null
  daysUntilRefreshTokenExpiry: number | null
  needsKeepAlive: boolean
  refreshTokenIdleDays: number
  createdAt: string
  rateLimitTotal: number | null
  rateLimitRemaining: number | null
  rateLimitResetsAt: string | null
  rateLimitObservedAt: string | null
  rateLimitPauseThreshold: number | null
  /** Scheduled-poll lookback override in hours. Null = the built-in 48h default. */
  pollLookbackHours: number | null
}

export function formatDateTime(iso: string | null) {
  if (!iso) return "Never"
  return new Date(iso).toLocaleString()
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "CONNECTED") return <Badge variant="default">Connected</Badge>
  if (status === "ERROR") return <Badge variant="destructive">Error</Badge>
  return <Badge variant="secondary">Not connected</Badge>
}

// Beds24's account-wide API credit pool, as last observed off response headers (see
// src/lib/channels/beds24.ts) — not polled separately, so "not yet observed" just means no
// real call has happened yet. The threshold below is the operator's own safety margin:
// push/poll skip a real call once remaining credits reach it, rather than waiting for
// Beds24 itself to start rejecting requests.
export function RateLimitPanel({
  c,
  canManage,
  onSave,
}: {
  c: Connection
  canManage: boolean
  onSave: (threshold: number | null) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(c.rateLimitPauseThreshold?.toString() ?? "")
  // Whether display alone is "paused" depends on the current wall-clock time, which a
  // component body must not read directly during render (React treats Date.now() as an
  // impure read) — so it is computed in an effect instead, same as any other read of
  // outside-the-render-tree state.
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    setDraft(c.rateLimitPauseThreshold?.toString() ?? "")
  }, [c.rateLimitPauseThreshold])

  useEffect(() => {
    const resetsAt = c.rateLimitResetsAt ? new Date(c.rateLimitResetsAt) : null
    setPaused(
      c.rateLimitPauseThreshold != null &&
        c.rateLimitRemaining != null &&
        resetsAt !== null &&
        resetsAt.getTime() > Date.now() &&
        c.rateLimitRemaining <= c.rateLimitPauseThreshold
    )
  }, [c.rateLimitPauseThreshold, c.rateLimitRemaining, c.rateLimitResetsAt])

  const resetsAt = c.rateLimitResetsAt ? new Date(c.rateLimitResetsAt) : null

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Rate limit</span>
        {paused && <Badge variant="destructive">Self-paused</Badge>}
      </div>

      {c.rateLimitTotal === null ? (
        <p className="text-sm text-muted-foreground">Not yet observed — shown after the next real API call.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {c.rateLimitRemaining} / {c.rateLimitTotal} credits remaining
          {resetsAt && `, resets ${resetsAt.toLocaleTimeString()}`}
          {c.rateLimitObservedAt && ` (as of ${formatDateTime(c.rateLimitObservedAt)})`}
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`rate-limit-pause-${c.id}`} className="text-xs text-muted-foreground">
            Pause syncing at or below
          </Label>
          <Input
            id={`rate-limit-pause-${c.id}`}
            type="number"
            min={0}
            step={1}
            value={draft}
            placeholder="Off"
            className="h-8 w-24"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const trimmed = draft.trim()
              const parsed = trimmed === "" ? null : Number(trimmed)
              if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
                setDraft(c.rateLimitPauseThreshold?.toString() ?? "")
                return
              }
              if (parsed === (c.rateLimitPauseThreshold ?? null)) return
              void onSave(parsed)
            }}
          />
          <span className="text-xs text-muted-foreground">credits (blank = never self-pause)</span>
        </div>
      )}
    </div>
  )
}
