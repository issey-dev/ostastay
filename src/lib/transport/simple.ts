import { prisma } from "@/lib/db"
import { BookingError } from "@/lib/booking-error"
import { isTransportActive } from "@/lib/transport/common"
import { dateToKey, localToUtc, utcToLocal } from "@/lib/transport/time"
import {
  isEmptySimpleLeg,
  simpleTransportSchema,
  type SimpleDirection,
  type SimpleTransport,
  type SimpleTransportLeg,
} from "@/lib/transport/simple-schema"

// The reservation's simple Transport section (owner, 2026-10-04): flight no., transport no.
// and flight time for the pickup and the drop-off — nothing else, no charges. Stored on
// ReservationTransport (carrierCode / transportNo / carrierTime).
//
// Where the Transportation module is active (add-on + property switch) the section is
// READ-ONLY and filled from the module's bookings; edits are refused here so the module is
// the single place transfers are managed.

const MODULE_DIR: Record<SimpleDirection, string> = { PICKUP: "PICKUP", DROPOFF: "DROP_OFF" }
const LIVE = ["DRAFT", "CONFIRMED", "ASSIGNED", "COMPLETED"]

function local(instant: Date | null, tz: string) {
  if (!instant) return { flightDate: null, flightTime: null }
  const l = utcToLocal(instant, tz)
  return { flightDate: l.dateKey, flightTime: l.time }
}

export async function reservationSimpleTransport(reservationId: string): Promise<SimpleTransport | null> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { propertyId: true, property: { select: { timeZone: true } }, transports: true },
  })
  if (!reservation) return null
  const tz = reservation.property.timeZone || "UTC"
  const managedByModule = await isTransportActive(reservation.propertyId)

  const legs: Record<SimpleDirection, SimpleTransportLeg | null> = { PICKUP: null, DROPOFF: null }
  for (const dir of ["PICKUP", "DROPOFF"] as const) {
    const leg = reservation.transports.find((t) => t.direction === dir)
    if (!leg) continue
    legs[dir] = {
      flightNo: leg.carrierCode,
      transportNo: leg.transportNo,
      ...local(leg.carrierTime, tz),
      legacyCharge:
        leg.chargeToGuest && (leg.chargeAmount ?? 0) > 0
          ? { amount: leg.chargeAmount!, posted: !!leg.chargedLineItemId }
          : null,
    }
  }

  if (managedByModule) {
    const bookings = await prisma.transportBooking.findMany({
      where: { reservationId, propertyId: reservation.propertyId, status: { in: LIVE } },
      select: {
        direction: true,
        status: true,
        flightNo: true,
        flightAt: true,
        vessel: { select: { name: true, registration: true } },
        manifest: { select: { vessel: { select: { name: true, registration: true } } } },
      },
      orderBy: [{ serviceDate: "asc" }, { createdAt: "asc" }],
    })
    for (const dir of ["PICKUP", "DROPOFF"] as const) {
      const mine = bookings.filter((b) => b.direction === MODULE_DIR[dir])
      // A confirmed transfer wins over a draft; otherwise the earliest.
      const b = mine.find((x) => x.status !== "DRAFT") ?? mine[0]
      if (!b) continue
      const vessel = b.manifest?.vessel ?? b.vessel
      legs[dir] = {
        flightNo: b.flightNo,
        transportNo: vessel ? (vessel.registration ? `${vessel.name} (${vessel.registration})` : vessel.name) : null,
        ...local(b.flightAt, tz),
        legacyCharge: null,
      }
    }
  }

  return { managedByModule, legs }
}

/**
 * Save the simple section. A leg with all three fields empty is removed — unless it still
 * carries a charge entered on the older card, which is kept (Night Audit / Advance Bill still
 * post an unposted one; a posted one keeps its link), with only the three fields cleared.
 */
export async function saveReservationSimpleTransport(reservationId: string, body: unknown) {
  const parsed = simpleTransportSchema.safeParse(body ?? {})
  if (!parsed.success) {
    const details: Record<string, string> = {}
    for (const issue of parsed.error.issues) details[issue.path.join(".")] ??= issue.message
    throw new BookingError(400, "VALIDATION", Object.values(details)[0] ?? "Invalid transport details", { details })
  }
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { id: true, propertyId: true, checkInDate: true, checkOutDate: true, property: { select: { timeZone: true } }, transports: true },
  })
  if (!reservation) throw new BookingError(404, "NOT_FOUND", "Reservation not found")
  if (await isTransportActive(reservation.propertyId)) {
    throw new BookingError(
      409,
      "MANAGED_BY_TRANSPORTATION",
      "Transport for this property is managed in Transportation. Add or change the transfer there."
    )
  }
  const tz = reservation.property.timeZone || "UTC"

  const input = { PICKUP: parsed.data.pickup, DROPOFF: parsed.data.dropoff }
  await prisma.$transaction(async (tx) => {
    for (const dir of ["PICKUP", "DROPOFF"] as const) {
      const leg = input[dir]
      const existing = reservation.transports.find((t) => t.direction === dir)
      const hasCharge = !!existing && (existing.chargeToGuest || !!existing.chargedLineItemId)
      if (isEmptySimpleLeg(leg) && existing && !hasCharge) {
        await tx.reservationTransport.delete({ where: { id: existing.id } })
        continue
      }
      if (isEmptySimpleLeg(leg) && !existing) continue
      const day = dateToKey(dir === "PICKUP" ? reservation.checkInDate : reservation.checkOutDate)
      const data = {
        carrierCode: leg.flightNo || null,
        transportNo: leg.transportNo || null,
        carrierTime: leg.time ? localToUtc(day, leg.time, tz) : null,
      }
      // Only the three fields are written: an older leg's type, remarks and charge stay as they were.
      await tx.reservationTransport.upsert({
        where: { reservationId_direction: { reservationId, direction: dir } },
        create: { reservationId, direction: dir, ...data },
        update: data,
      })
    }
  })
  return reservationSimpleTransport(reservationId)
}
