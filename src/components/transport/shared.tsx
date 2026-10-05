"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, LogIn, LogOut } from "@/components/icons"
import { StatusBadge } from "@/components/ui/status-badge"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiError } from "@/lib/api-error"
import {
  BILLING_STATUS_LABELS,
  BOOKING_STATUS_LABELS,
  DIRECTION_LABELS,
  MANIFEST_STATUS_LABELS,
  STATUS_TONES,
  label,
} from "@/lib/transport/constants"
import type { BookingView } from "@/lib/transport/bookings"
import type { ManifestView } from "@/lib/transport/manifests"
import type { TransportConfig } from "@/components/hub/transport/types"
import { cn } from "@/lib/utils"

// Shared pieces of the Transportation operations screens (board, airport rep and dispatch
// views, the reservation panel): data hooks, badges and small formatters.

export type { BookingView, ManifestView, TransportConfig }
export type Staff = { id: string; name: string; jobFunction: string | null }

/** fetch + JSON, throwing the API's own message on failure. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.json !== undefined ? { "Content-Type": "application/json" } : init?.headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })
  if (!res.ok) throw new Error(await apiError(res, "Something went wrong. Try again."))
  return res.json() as Promise<T>
}

export function useTransportConfig(propertyId: string | null | undefined) {
  const [config, setConfig] = useState<TransportConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    if (!propertyId) return
    api<TransportConfig>(`/api/transport/config?propertyId=${propertyId}`)
      .then((c) => {
        setConfig(c)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [propertyId])
  useEffect(() => {
    load()
  }, [load])
  return { config, error, reload: load }
}

export function useStaff(propertyId: string | null | undefined) {
  const [staff, setStaff] = useState<Staff[]>([])
  useEffect(() => {
    if (!propertyId) return
    api<Staff[]>(`/api/transport/staff?propertyId=${propertyId}`).then(setStaff).catch(() => setStaff([]))
  }, [propertyId])
  return staff
}

export function BookingStatus({ status, className }: { status: string; className?: string }) {
  return <StatusBadge className={className} tone={STATUS_TONES[status] ?? "neutral"} label={label(BOOKING_STATUS_LABELS, status)} />
}

export function ManifestStatus({ status }: { status: string }) {
  return <StatusBadge tone={STATUS_TONES[status] ?? "neutral"} label={label(MANIFEST_STATUS_LABELS, status)} />
}

export function BillingStatus({ status }: { status: string }) {
  return <StatusBadge tone={STATUS_TONES[status] ?? "neutral"} label={label(BILLING_STATUS_LABELS, status)} />
}

/** The "Needs attention" badge, with the reasons on hover/focus. */
export function AttentionBadge({ reasons, compact }: { reasons: { message: string }[]; compact?: boolean }) {
  if (!reasons.length) return null
  const badge = (
    <span
      className="inline-flex items-center gap-1 border border-warning/40 bg-warning-muted px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-warning"
      aria-label={`Needs attention: ${reasons.map((r) => r.message).join("; ")}`}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      {!compact && "Needs attention"}
    </span>
  )
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>{badge}</TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5">
          {reasons.map((r, i) => (
            <li key={i}>{r.message}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

export function GroupTag({ group }: { group: { code: string; name: string } | null }) {
  if (!group) return null
  return (
    <Badge variant="outline" className="font-mono text-[10px]" title={`Group: ${group.name}`}>
      {group.code}
    </Badge>
  )
}

export function DirectionIcon({ direction, className }: { direction: string; className?: string }) {
  const Icon = direction === "PICKUP" ? LogIn : LogOut
  return <Icon className={cn("h-4 w-4 text-muted-foreground", className)} aria-label={label(DIRECTION_LABELS, direction)} />
}

export const paxLabel = (b: { adults: number; children: number; infants: number }) =>
  [b.adults && `${b.adults}A`, b.children && `${b.children}C`, b.infants && `${b.infants}I`].filter(Boolean).join(" ") || "0"

export const flightLabel = (b: BookingView) => [b.flightNo, b.flightLocal?.time].filter(Boolean).join(" · ")

export const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`)

export const addDays = (dateKey: string, days: number) => {
  const d = new Date(`${dateKey}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const dayLabel = (dateKey: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "2-digit", month: "short" }) =>
  new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" })
