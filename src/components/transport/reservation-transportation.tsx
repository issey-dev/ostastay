"use client"

import { useCallback, useEffect, useState } from "react"
import { Plus, Ship } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { DIRECTION_LABELS, label } from "@/lib/transport/constants"
import { cn } from "@/lib/utils"
import {
  api,
  AttentionBadge,
  BillingStatus,
  BookingStatus,
  DirectionIcon,
  dayLabel,
  flightLabel,
  useStaff,
  useTransportConfig,
  type BookingView,
} from "@/components/transport/shared"
import { BookingFormDialog, type BookingPrefill } from "@/components/transport/booking-form-dialog"
import { BookingPanel, type TransportPerms } from "@/components/transport/booking-panel"

// The reservation page's Transportation card (where the module is on at the property): the
// stay's transfers in date order, quick-add for the arrival pickup and departure drop-off,
// and the same side panel as the board for details and actions.

type Reservation = {
  id: string
  propertyId: string
  confirmationNo: string
  status: string
  checkInDate: string
  checkOutDate: string
  adults: number
  children: number
  infants: number
  guestName: string
  groupBlock: { id: string; code: string; name: string } | null
}

export function ReservationTransportation({
  reservation,
  perms,
  openSignal,
  onChanged,
  className,
}: {
  reservation: Reservation
  perms: TransportPerms
  /** Bump to open "Add transfer" from outside (the page's "+ Add transfer" link). */
  openSignal?: number
  onChanged?: () => void
  className?: string
}) {
  const propertyId = reservation.propertyId
  const [bookings, setBookings] = useState<BookingView[] | null>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [form, setForm] = useState<{ editing: BookingView | null; prefill?: BookingPrefill } | null>(null)
  const { config } = useTransportConfig(form || panelId ? propertyId : null)
  const staff = useStaff(form ? propertyId : null)

  const load = useCallback(() => {
    api<{ items: BookingView[] }>(`/api/transport/bookings?propertyId=${propertyId}&reservationId=${reservation.id}`)
      .then((r) => setBookings(r.items))
      .catch(() => setBookings([]))
  }, [propertyId, reservation.id])
  useEffect(() => {
    load()
  }, [load])

  const live = reservation.status === "RESERVED" || reservation.status === "IN_HOUSE"
  const prefill = (direction: "PICKUP" | "DROP_OFF"): BookingPrefill => ({
    reservation: {
      id: reservation.id,
      confirmationNo: reservation.confirmationNo,
      guestName: reservation.guestName,
      checkInDate: reservation.checkInDate.slice(0, 10),
      checkOutDate: reservation.checkOutDate.slice(0, 10),
      adults: reservation.adults,
      children: reservation.children,
      infants: reservation.infants,
      groupBlock: reservation.groupBlock,
    },
    direction,
  })
  useEffect(() => {
    if (openSignal && perms.manageBookings) setForm({ editing: null, prefill: prefill("PICKUP") })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal])

  const active = (bookings ?? []).filter((b) => b.status !== "CANCELLED")
  const hasPickup = active.some((b) => b.direction === "PICKUP")
  const hasDropOff = active.some((b) => b.direction === "DROP_OFF")
  const suggest: ("PICKUP" | "DROP_OFF")[] = live && perms.manageBookings ? [...(!hasPickup && reservation.status === "RESERVED" ? (["PICKUP"] as const) : []), ...(!hasDropOff ? (["DROP_OFF"] as const) : [])] : []

  return (
    <Card className={cn("shadow-elevation-1 lg:col-span-2", className)}>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Ship className="h-5 w-5 text-muted-foreground" /> Transportation
        </CardTitle>
        {perms.manageBookings && live && (
          <Button variant="outline" size="sm" onClick={() => setForm({ editing: null, prefill: prefill(hasPickup ? "DROP_OFF" : "PICKUP") })}>
            <Plus className="mr-2 h-4 w-4" /> Add transfer
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {bookings === null ? (
          <Skeleton className="h-16 w-full" />
        ) : bookings.length === 0 && suggest.length === 0 ? (
          <EmptyState size="inline" title="No transfers arranged" />
        ) : (
          <ul className="divide-y divide-border border border-border">
            {bookings.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setPanelId(b.id)}
                  className={cn("flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 p-3 text-left hover:bg-muted/50", b.status === "CANCELLED" && "text-muted-foreground")}
                >
                  <DirectionIcon direction={b.direction} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {label(DIRECTION_LABELS, b.direction)} · {dayLabel(b.serviceDate)}
                      {b.departureLocal ? ` · ${b.departureLocal.time}` : ""}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {[b.route?.name, flightLabel(b), `${b.pax} pax`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <AttentionBadge reasons={b.attention} compact />
                  <BookingStatus status={b.status} />
                  <BillingStatus status={b.billing.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {suggest.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Suggested:</span>
            {suggest.map((d) => (
              <Button key={d} variant="outline" size="sm" className="h-8" onClick={() => setForm({ editing: null, prefill: prefill(d) })}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {d === "PICKUP" ? `Pickup on ${dayLabel(reservation.checkInDate.slice(0, 10))}` : `Drop-off on ${dayLabel(reservation.checkOutDate.slice(0, 10))}`}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
      <BookingPanel
        bookingId={panelId}
        onOpenChange={(o) => !o && setPanelId(null)}
        propertyId={propertyId}
        config={config}
        perms={perms}
        onChanged={() => {
          load()
          onChanged?.()
        }}
        onEdit={(b) => setForm({ editing: b })}
      />
      <BookingFormDialog
        open={!!form}
        onOpenChange={(o) => !o && setForm(null)}
        propertyId={propertyId}
        config={config}
        staff={staff}
        editing={form?.editing ?? null}
        prefill={form?.prefill}
        canBill={perms.canBill}
        defaultDate={reservation.checkInDate.slice(0, 10)}
        onSaved={() => {
          load()
          onChanged?.()
        }}
      />
    </Card>
  )
}

/** Whether Transportation is on at the property, and the user's permissions — for pages
 *  other than the board. Null while loading. */
export function useTransportAccess(propertyId: string | null | undefined) {
  const [access, setAccess] = useState<{ enabled: boolean; perms: TransportPerms & { view: boolean } } | null>(null)
  useEffect(() => {
    if (!propertyId) return
    api<{ enabled: boolean; perms: TransportPerms & { view: boolean } }>(`/api/transport/access?propertyId=${propertyId}`)
      .then(setAccess)
      .catch(() => setAccess({ enabled: false, perms: { view: false, manageBookings: false, manageManifests: false, canBill: false, canVoid: false } }))
  }, [propertyId])
  return access
}
