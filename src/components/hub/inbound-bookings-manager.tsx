"use client"

import { useCallback, useEffect, useState } from "react"
import { ArrowLeftRight, RefreshCw, ShieldAlert } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/ui/error-state"
import { toast } from "@/lib/toast"

// Bookings received from the channel manager.
//
// The overbooking count is the reason this screen matters. Per D-7 rule 4 an inbound
// booking that exceeds availability is still accepted — the channel already promised it to
// the guest — so this is where the desk finds out, ideally days before arrival.

type InboundBooking = {
  id: string
  externalBookingId: string
  channelName: string | null
  source: string
  externalRoomId: string | null
  guestFirstName: string | null
  guestLastName: string | null
  arrival: string | null
  departure: string | null
  adults: number | null
  totalAmount: number | null
  currency: string | null
  channelStatus: string | null
  problem: string | null
  isOverbooking: boolean
  overbookingNote: string | null
  acknowledgedAt: string | null
  receivedAt: string
  roomTypeName: string | null
  propertyName: string | null
}

const ALL = "__all__"
const FILTER_LABELS: Record<string, string> = {
  [ALL]: "All bookings",
  overbookings: "Overbookings only",
  problems: "Problems only",
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString()
}

export function InboundBookingsManager({ canManage }: { canManage: boolean }) {
  const [bookings, setBookings] = useState<InboundBooking[]>([])
  const [overbookings, setOverbookings] = useState(0)
  const [problems, setProblems] = useState(0)
  const [filter, setFilter] = useState(ALL)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const q = filter === ALL ? "" : `?filter=${filter}`
      const res = await fetch(`/api/hub/inbound-bookings${q}`)
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      setBookings(data.bookings ?? [])
      setOverbookings(data.unacknowledgedOverbookings ?? 0)
      setProblems(data.withProblems ?? 0)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const acknowledge = async (b: InboundBooking) => {
    setBusyId(b.id)
    try {
      const res = await fetch(`/api/hub/inbound-bookings/${b.id}/acknowledge`, { method: "POST" })
      if (!res.ok) {
        toast.error("Could not acknowledge")
        return
      }
      toast.success("Acknowledged")
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <Skeleton className="h-48 w-full" />
  if (failed) return <ErrorState onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      {/* The one thing on this screen that needs a human today. */}
      {overbookings > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive-muted px-4 py-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-semibold text-destructive">
              {overbookings} booking{overbookings === 1 ? "" : "s"} exceed available rooms
            </p>
            <p className="text-destructive/90">
              These were accepted because the booking channel had already confirmed them to the guest. They need
              resolving before arrival.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filter} onValueChange={(v) => setFilter(v ?? ALL)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue>{FILTER_LABELS[filter] ?? FILTER_LABELS[ALL]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{FILTER_LABELS[ALL]}</SelectItem>
            <SelectItem value="overbookings">{FILTER_LABELS.overbookings}</SelectItem>
            <SelectItem value="problems">{FILTER_LABELS.problems}</SelectItem>
          </SelectContent>
        </Select>
        {problems > 0 && <Badge variant="secondary">{problems} need attention</Badge>}
        <Button variant="outline" size="sm" onClick={() => void load()} className="ml-auto">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {bookings.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No bookings received"
          description="Bookings from Booking.com, Expedia, Airbnb and Agoda will appear here once the webhook is connected."
        />
      ) : (
        <>
          {/* Phone view — the table is six columns wide (seven with the action column),
              unreadable on a narrow screen. Each booking becomes a card instead. */}
          <div className="space-y-3 md:hidden">
            {bookings.map((b) => (
              <div
                key={b.id}
                className={`space-y-3 rounded-md border p-4 ${
                  b.isOverbooking && !b.acknowledgedAt ? "border-destructive/30 bg-destructive-muted/40" : "border-border bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {[b.guestFirstName, b.guestLastName].filter(Boolean).join(" ") || "—"}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{b.externalBookingId}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {b.isOverbooking && (
                      <Badge variant={b.acknowledgedAt ? "secondary" : "destructive"}>
                        {b.acknowledgedAt ? "Overbooking (seen)" : "Overbooking"}
                      </Badge>
                    )}
                    {b.channelStatus && !b.isOverbooking && <Badge variant="secondary">{b.channelStatus}</Badge>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="whitespace-nowrap">{fmtDate(b.arrival)} → {fmtDate(b.departure)}</span>
                  <span>
                    {b.roomTypeName ?? (
                      <span className="text-muted-foreground">
                        unmapped{b.externalRoomId ? ` (${b.externalRoomId})` : ""}
                      </span>
                    )}
                  </span>
                </div>

                <div className="text-sm text-muted-foreground">
                  {b.channelName ?? "—"} · {b.source === "WEBHOOK" ? "webhook" : "poll"}
                </div>

                {(b.problem || b.overbookingNote) && (
                  <div className="space-y-1">
                    {b.problem && <p className="text-xs text-destructive">{b.problem}</p>}
                    {b.overbookingNote && <p className="text-xs text-destructive">{b.overbookingNote}</p>}
                  </div>
                )}

                {canManage && b.isOverbooking && !b.acknowledgedAt && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-full"
                    disabled={busyId === b.id}
                    onClick={() => void acknowledge(b)}
                  >
                    Acknowledge
                  </Button>
                )}
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-md border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>Stay</TableHead>
                <TableHead>Room type</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id} className={b.isOverbooking && !b.acknowledgedAt ? "bg-destructive-muted/40" : ""}>
                  <TableCell>
                    <div className="text-sm font-medium">
                      {[b.guestFirstName, b.guestLastName].filter(Boolean).join(" ") || "—"}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{b.externalBookingId}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {fmtDate(b.arrival)} → {fmtDate(b.departure)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.roomTypeName ?? (
                      <span className="text-muted-foreground">
                        unmapped{b.externalRoomId ? ` (${b.externalRoomId})` : ""}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.channelName ?? "—"}
                    <div className="text-xs text-muted-foreground">{b.source === "WEBHOOK" ? "webhook" : "poll"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {b.isOverbooking && (
                        <Badge variant={b.acknowledgedAt ? "secondary" : "destructive"}>
                          {b.acknowledgedAt ? "Overbooking (seen)" : "Overbooking"}
                        </Badge>
                      )}
                      {b.channelStatus && !b.isOverbooking && <Badge variant="secondary">{b.channelStatus}</Badge>}
                      {b.problem && <span className="text-xs text-destructive">{b.problem}</span>}
                      {b.overbookingNote && <span className="text-xs text-destructive">{b.overbookingNote}</span>}
                    </div>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {b.isOverbooking && !b.acknowledgedAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyId === b.id}
                          onClick={() => void acknowledge(b)}
                        >
                          Acknowledge
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Received bookings are recorded here for review. Turning one into a reservation is still done by hand — see{" "}
        <code className="text-xs">.agents/docs/HUB_CHANNEL_MANAGER_PLAN.md</code>.
      </p>
    </div>
  )
}
