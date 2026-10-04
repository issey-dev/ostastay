import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { logActivity } from "@/lib/activity-log"
import { capacityState } from "@/lib/transport/attention"
import { BOOKING_INCLUDE, applyBookingStatus, bookingReference, serializeBooking, type BookingView } from "@/lib/transport/bookings"
import { assertTransportEnabled, fromZod, invalid, notFound, propertyTz, type TransportActor } from "@/lib/transport/common"
import { LIVE_BOOKING_STATUSES } from "@/lib/transport/constants"
import { fromSlotsSchema, manifestBookingsSchema, manifestCreateSchema, manifestUpdateSchema } from "@/lib/transport/schemas"
import { addDaysKey, dateKeyToDate, dateToKey, localToUtc, utcToLocal } from "@/lib/transport/time"

// Manifests — one departure (a boat, seaplane or car leaving at a time) that bookings from
// any number of reservations ride on together. The core operational object of the module.
// Pax and seats are counted live from the attached bookings; going over the vessel's seats
// is a soft warning only, never a block.

type Tx = Prisma.TransactionClient

export const MANIFEST_INCLUDE = {
  route: {
    include: {
      origin: { select: { id: true, code: true, name: true, type: true } },
      destination: { select: { id: true, code: true, name: true, type: true } },
    },
  },
  transportType: { select: { id: true, code: true, name: true, mode: true } },
  provider: { select: { id: true, name: true, kind: true, phone: true } },
  vessel: { select: { id: true, name: true, capacity: true } },
  bookings: { include: BOOKING_INCLUDE, orderBy: [{ flightAt: "asc" as const }, { guestName: "asc" as const }] },
} satisfies Prisma.TransportManifestInclude

type ManifestRow = Prisma.TransportManifestGetPayload<{ include: typeof MANIFEST_INCLUDE }>

const COUNTS = new Set<string>(LIVE_BOOKING_STATUSES)

export function manifestReference(id: string): string {
  return `DEP-${id.slice(0, 6).toUpperCase()}`
}

export function serializeManifest(m: ManifestRow, opts: { timeZone: string; toleranceMinutes: number }) {
  const bookings: BookingView[] = m.bookings.map((b) => serializeBooking(b, opts))
  const travelling = bookings.filter((b) => COUNTS.has(b.status))
  const pax = travelling.reduce((s, b) => s + b.pax, 0)
  const capacity = m.vessel?.capacity ?? null
  const cap = capacityState(pax, capacity)
  const attentionCount = bookings.filter((b) => b.attention.length > 0).length
  return {
    id: m.id,
    reference: manifestReference(m.id),
    propertyId: m.propertyId,
    serviceDate: dateToKey(m.serviceDate),
    departureAt: m.departureAt.toISOString(),
    departureLocal: utcToLocal(m.departureAt, opts.timeZone),
    direction: m.direction,
    status: m.status,
    route: {
      id: m.route.id,
      code: m.route.code,
      name: m.route.name,
      category: m.route.category,
      durationMinutes: m.route.durationMinutes,
      origin: m.route.origin,
      destination: m.route.destination,
    },
    transportType: m.transportType,
    provider: m.provider,
    vessel: m.vessel,
    driverName: m.driverName,
    driverContact: m.driverContact,
    notes: m.notes,
    pax,
    adults: travelling.reduce((s, b) => s + b.adults, 0),
    children: travelling.reduce((s, b) => s + b.children, 0),
    infants: travelling.reduce((s, b) => s + b.infants, 0),
    capacity,
    capacityState: cap,
    attentionCount,
    bookings,
  }
}

export type ManifestView = ReturnType<typeof serializeManifest>

async function viewOpts(propertyId: string) {
  const [p, s] = await Promise.all([propertyTz(propertyId), prisma.transportSettings.findUnique({ where: { propertyId } })])
  return { timeZone: p.timeZone, toleranceMinutes: s?.attentionToleranceMinutes ?? 60 }
}

export async function getManifest(propertyId: string, id: string): Promise<ManifestView> {
  const m = await prisma.transportManifest.findFirst({ where: { id, propertyId }, include: MANIFEST_INCLUDE })
  if (!m) throw notFound("Departure")
  return serializeManifest(m, await viewOpts(propertyId))
}

export async function listManifests(
  propertyId: string,
  f: { from?: string | null; to?: string | null; direction?: string | null; routeId?: string | null; includeCancelled?: boolean } = {}
) {
  const where: Prisma.TransportManifestWhereInput = { propertyId }
  if (f.from || f.to) {
    where.serviceDate = {
      ...(f.from ? { gte: dateKeyToDate(f.from) } : {}),
      ...(f.to ? { lt: dateKeyToDate(addDaysKey(f.to, 1)) } : {}),
    }
  }
  if (f.direction) where.direction = f.direction
  if (f.routeId) where.routeId = f.routeId
  if (!f.includeCancelled) where.status = { not: "CANCELLED" }
  const rows = await prisma.transportManifest.findMany({ where, include: MANIFEST_INCLUDE, orderBy: [{ departureAt: "asc" }], take: 500 })
  const opts = await viewOpts(propertyId)
  return rows.map((m) => serializeManifest(m, opts))
}

async function checkRefs(propertyId: string, v: { routeId?: string | null; transportTypeId?: string | null; providerId?: string | null; vesselId?: string | null }) {
  const fail = (what: string) => {
    throw invalid(`${what} not found at this property`, "INVALID_REFERENCE")
  }
  if (v.routeId && !(await prisma.transportRoute.findFirst({ where: { id: v.routeId, propertyId } }))) fail("Route")
  if (v.transportTypeId && !(await prisma.transportType.findFirst({ where: { id: v.transportTypeId, propertyId } }))) fail("Transport type")
  if (v.providerId && !(await prisma.transportProvider.findFirst({ where: { id: v.providerId, propertyId } }))) fail("Provider")
  if (v.vesselId) {
    const vessel = await prisma.transportVessel.findFirst({ where: { id: v.vesselId, propertyId } })
    if (!vessel) fail("Vessel")
    if (v.providerId && vessel && vessel.providerId !== v.providerId) throw invalid("That vessel belongs to another provider", "INVALID_REFERENCE")
  }
}

/**
 * Attach bookings (moving them from another departure if they were on one). The booking
 * takes the departure's day — attaching IS rescheduling onto it — and an attached CONFIRMED
 * booking becomes ASSIGNED (a DRAFT stays a draft: nothing is ever confirmed automatically).
 * The flight time is noted so a later change is flagged on the board.
 */
async function attach(tx: Tx, manifest: { id: string; direction: string; serviceDate: Date; propertyId: string }, bookingIds: string[]) {
  const bookings = await tx.transportBooking.findMany({ where: { id: { in: bookingIds }, propertyId: manifest.propertyId } })
  if (bookings.length !== new Set(bookingIds).size) throw notFound("Transport booking")
  for (const b of bookings) {
    if (b.status === "CANCELLED") throw invalid(`${b.guestName} is cancelled — reinstate the booking first.`, "BOOKING_CANCELLED")
    if (b.direction !== manifest.direction) {
      throw invalid(`${b.guestName} is a ${b.direction === "PICKUP" ? "pickup" : "drop-off"} — this departure is a ${manifest.direction === "PICKUP" ? "pickup" : "drop-off"}.`, "DIRECTION_MISMATCH")
    }
    await tx.transportBooking.update({
      where: { id: b.id },
      data: {
        manifestId: manifest.id,
        serviceDate: manifest.serviceDate,
        flightAtOnManifest: b.flightAt,
        status: b.status === "CONFIRMED" ? "ASSIGNED" : b.status,
      },
    })
  }
  return bookings
}

export async function createManifest(actor: TransportActor, propertyId: string, body: unknown): Promise<ManifestView> {
  await assertTransportEnabled(propertyId)
  const parsed = manifestCreateSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const v = parsed.data
  await checkRefs(propertyId, v)
  const { timeZone } = await propertyTz(propertyId)
  const route = await prisma.transportRoute.findUniqueOrThrow({ where: { id: v.routeId } })
  if (route.direction !== "BOTH" && route.direction !== v.direction) {
    throw invalid(`This route is for ${route.direction === "PICKUP" ? "pickups" : "drop-offs"} only.`, "DIRECTION_MISMATCH")
  }
  const departureAt = localToUtc(v.serviceDate, v.departureTime, timeZone)
  const created = await prisma.$transaction(async (tx) => {
    const m = await tx.transportManifest.create({
      data: {
        propertyId,
        serviceDate: dateKeyToDate(v.serviceDate),
        departureAt,
        routeId: v.routeId,
        direction: v.direction,
        transportTypeId: v.transportTypeId ?? route.transportTypeId,
        providerId: v.providerId,
        vesselId: v.vesselId,
        driverName: v.driverName,
        driverContact: v.driverContact,
        notes: v.notes,
        createdByUserId: actor.userId,
      },
    })
    if (v.bookingIds.length) await attach(tx, m, v.bookingIds)
    return m
  })
  await logActivity({
    ctx: actor.ctx,
    module: "TRANSPORTATION",
    action: "CREATE",
    entityType: "TransportManifest",
    entityId: created.id,
    description: `Departure ${manifestReference(created.id)}: ${route.name} ${v.serviceDate} ${v.departureTime}${v.bookingIds.length ? ` with ${v.bookingIds.length} booking(s)` : ""}`,
    metadata: { propertyId, source: actor.source },
  })
  return getManifest(propertyId, created.id)
}

/** Create the day's OPEN departures from the routes' default times (skips existing ones). */
export async function createManifestsFromSlots(actor: TransportActor, propertyId: string, body: unknown) {
  await assertTransportEnabled(propertyId)
  const parsed = fromSlotsSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const v = parsed.data
  const { timeZone } = await propertyTz(propertyId)
  const routes = await prisma.transportRoute.findMany({
    where: {
      propertyId,
      isActive: true,
      direction: { in: [v.direction, "BOTH"] },
      ...(v.routeId ? { id: v.routeId } : {}),
    },
  })
  let created = 0
  let skipped = 0
  for (const r of routes) {
    for (const slot of r.departureSlots) {
      const departureAt = localToUtc(v.serviceDate, slot, timeZone)
      const exists = await prisma.transportManifest.findFirst({
        where: { propertyId, routeId: r.id, direction: v.direction, departureAt, status: { not: "CANCELLED" } },
        select: { id: true },
      })
      if (exists) {
        skipped++
        continue
      }
      await prisma.transportManifest.create({
        data: {
          propertyId,
          serviceDate: dateKeyToDate(v.serviceDate),
          departureAt,
          routeId: r.id,
          direction: v.direction,
          transportTypeId: r.transportTypeId,
          createdByUserId: actor.userId,
        },
      })
      created++
    }
  }
  if (created > 0) {
    await logActivity({
      ctx: actor.ctx,
      module: "TRANSPORTATION",
      action: "CREATE",
      entityType: "TransportManifest",
      description: `Created ${created} ${v.direction === "PICKUP" ? "pickup" : "drop-off"} departure(s) for ${v.serviceDate} from the routes' default times`,
      metadata: { propertyId, source: actor.source },
    })
  }
  return { created, skipped }
}

const MANIFEST_FLOW: Record<string, string[]> = {
  OPEN: ["CONFIRMED", "DEPARTED", "COMPLETED", "CANCELLED"],
  CONFIRMED: ["OPEN", "DEPARTED", "COMPLETED", "CANCELLED"],
  DEPARTED: ["CONFIRMED", "COMPLETED"],
  COMPLETED: ["DEPARTED"],
  CANCELLED: ["OPEN"],
}

export async function updateManifest(actor: TransportActor, propertyId: string, id: string, body: unknown) {
  const settings = await assertTransportEnabled(propertyId)
  const parsed = manifestUpdateSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const v = parsed.data
  const m = await prisma.transportManifest.findFirst({ where: { id, propertyId }, include: { bookings: true } })
  if (!m) throw notFound("Departure")
  await checkRefs(propertyId, { ...v, providerId: v.providerId === undefined ? m.providerId : v.providerId })
  const { timeZone } = await propertyTz(propertyId)

  if (v.status && v.status !== m.status) {
    if (!MANIFEST_FLOW[m.status]?.includes(v.status)) throw invalid(`A ${m.status.toLowerCase()} departure can't become ${v.status.toLowerCase()}.`, "INVALID_STATUS_CHANGE")
    const provider = v.providerId === undefined ? m.providerId : v.providerId
    if (settings.requireProvider && ["CONFIRMED", "DEPARTED", "COMPLETED"].includes(v.status) && !provider) {
      throw invalid("Assign a provider first — this property requires one.", "PROVIDER_REQUIRED")
    }
  }

  const dateKey = v.serviceDate ?? dateToKey(m.serviceDate)
  const time = v.departureTime ?? utcToLocal(m.departureAt, timeZone).time
  const data: Prisma.TransportManifestUncheckedUpdateInput = {}
  for (const k of ["transportTypeId", "providerId", "vesselId", "driverName", "driverContact", "notes", "status"] as const) {
    if (v[k] !== undefined) (data as Record<string, unknown>)[k] = v[k]
  }
  if (v.serviceDate || v.departureTime) {
    data.serviceDate = dateKeyToDate(dateKey)
    data.departureAt = localToUtc(dateKey, time, timeZone)
  }

  const cascade = { completed: 0, released: 0 }
  await prisma.$transaction(async (tx) => {
    await tx.transportManifest.update({ where: { id }, data })
    if (v.serviceDate) await tx.transportBooking.updateMany({ where: { manifestId: id }, data: { serviceDate: dateKeyToDate(dateKey) } })
    if (v.status === "COMPLETED") {
      // The trip ran: everyone still on it travelled.
      const r = await tx.transportBooking.updateMany({ where: { manifestId: id, status: { in: ["CONFIRMED", "ASSIGNED"] } }, data: { status: "COMPLETED" } })
      cascade.completed = r.count
    }
    if (v.status === "CANCELLED") {
      // The boat isn't going: its passengers are released to be put on another departure.
      const r = await tx.transportBooking.updateMany({
        where: { manifestId: id, status: { not: "CANCELLED" } },
        data: { manifestId: null, flightAtOnManifest: null },
      })
      await tx.transportBooking.updateMany({ where: { id: { in: m.bookings.map((b) => b.id) }, status: "ASSIGNED", providerId: null }, data: { status: "CONFIRMED" } })
      cascade.released = r.count
    }
  })
  await logActivity({
    ctx: actor.ctx,
    module: "TRANSPORTATION",
    action: v.status === "CANCELLED" ? "CANCEL" : "UPDATE",
    entityType: "TransportManifest",
    entityId: id,
    description: `Departure ${manifestReference(id)}${v.status && v.status !== m.status ? `: ${m.status} → ${v.status}` : " updated"}${cascade.completed ? ` (${cascade.completed} booking(s) completed)` : ""}${cascade.released ? ` (${cascade.released} booking(s) released)` : ""}`,
    metadata: { propertyId, source: actor.source, changed: Object.keys(v) },
  })
  return { manifest: await getManifest(propertyId, id), cascade }
}

export async function changeManifestBookings(actor: TransportActor, propertyId: string, id: string, body: unknown) {
  const settings = await assertTransportEnabled(propertyId)
  const parsed = manifestBookingsSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const { action, bookingIds } = parsed.data
  const m = await prisma.transportManifest.findFirst({ where: { id, propertyId } })
  if (!m) throw notFound("Departure")
  if (action === "ATTACH" && (m.status === "CANCELLED" || m.status === "COMPLETED")) {
    throw invalid(`This departure is ${m.status.toLowerCase()} — choose another.`, "MANIFEST_CLOSED")
  }

  const names = await prisma.$transaction(async (tx) => {
    if (action === "ATTACH") return (await attach(tx, m, bookingIds)).map((b) => b.guestName)
    const bookings = await tx.transportBooking.findMany({ where: { id: { in: bookingIds }, propertyId, manifestId: id } })
    if (bookings.length !== new Set(bookingIds).size) throw notFound("Transport booking on this departure")
    for (const b of bookings) {
      if (action === "KEEP") {
        await tx.transportBooking.update({ where: { id: b.id }, data: { flightAtOnManifest: b.flightAt } })
      } else {
        await tx.transportBooking.update({ where: { id: b.id }, data: { manifestId: null, flightAtOnManifest: null } })
        if (b.status === "ASSIGNED" && !b.providerId) await applyBookingStatus(tx, { ...b, manifestId: null, manifest: null }, "CONFIRMED", settings)
      }
    }
    return bookings.map((b) => b.guestName)
  })
  await logActivity({
    ctx: actor.ctx,
    module: "TRANSPORTATION",
    action: action === "ATTACH" ? "ASSIGN" : action === "DETACH" ? "UNASSIGN" : "UPDATE",
    entityType: "TransportManifest",
    entityId: id,
    description: `Departure ${manifestReference(id)}: ${action === "ATTACH" ? "added" : action === "DETACH" ? "removed" : "kept after a flight change"} ${names.join(", ")}`,
    metadata: { propertyId, source: actor.source, bookingIds: bookingIds.map(bookingReference) },
  })
  return getManifest(propertyId, id)
}
