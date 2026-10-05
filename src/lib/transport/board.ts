import { prisma } from "@/lib/db"
import { assertTransportEnabled } from "@/lib/transport/common"
import { listBookings, type BookingFilters } from "@/lib/transport/bookings"
import { listManifests } from "@/lib/transport/manifests"
import { addDaysKey, dateKeyToDate, dateToKey } from "@/lib/transport/time"

// The daily Transportation board's data: the week strip's arrival/departure counts, the
// day's bookings (filtered) and its departures. One read per day so the board, the Airport
// rep view and the Dispatch view all draw from the same data.

/** Monday of the week containing `dateKey`. */
export function weekStart(dateKey: string): string {
  const d = dateKeyToDate(dateKey)
  const dow = (d.getUTCDay() + 6) % 7
  return addDaysKey(dateKey, -dow)
}

export async function weekCounts(propertyId: string, dateKey: string) {
  const start = weekStart(dateKey)
  const rows = await prisma.transportBooking.groupBy({
    by: ["serviceDate", "direction"],
    where: {
      propertyId,
      status: { notIn: ["CANCELLED"] },
      serviceDate: { gte: dateKeyToDate(start), lt: dateKeyToDate(addDaysKey(start, 7)) },
    },
    _count: { _all: true },
    _sum: { adults: true, children: true, infants: true },
  })
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDaysKey(start, i)
    const of = (dir: string) => rows.find((r) => dateToKey(r.serviceDate) === key && r.direction === dir)
    const pax = (dir: string) => {
      const r = of(dir)
      return r ? (r._sum.adults ?? 0) + (r._sum.children ?? 0) + (r._sum.infants ?? 0) : 0
    }
    return {
      date: key,
      pickups: of("PICKUP")?._count._all ?? 0,
      dropOffs: of("DROP_OFF")?._count._all ?? 0,
      pickupPax: pax("PICKUP"),
      dropOffPax: pax("DROP_OFF"),
    }
  })
}

export async function boardData(propertyId: string, dateKey: string, filters: BookingFilters = {}) {
  await assertTransportEnabled(propertyId)
  const [week, bookings, manifests] = await Promise.all([
    weekCounts(propertyId, dateKey),
    listBookings(propertyId, { ...filters, from: dateKey, to: dateKey }),
    listManifests(propertyId, { from: dateKey, to: dateKey, direction: filters.direction ?? null }),
  ])
  return { date: dateKey, week, bookings: bookings.items, manifests }
}
