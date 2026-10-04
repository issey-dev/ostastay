import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { logActivity } from "@/lib/activity-log"
import { BookingError } from "@/lib/booking-error"
import { previewCharge, type ChargePreview } from "@/lib/posting/preview-charge"
import { chargeCodeInclude } from "@/lib/posting/post-charge"
import { getPropertySettings } from "@/lib/property-settings"
import { attentionFor, type AttentionReason } from "@/lib/transport/attention"
import {
  assertTransportEnabled,
  forbidden,
  fromZod,
  invalid,
  notFound,
  propertyTz,
  type TransportActor,
  type TransportSettingsValues,
} from "@/lib/transport/common"
import { ensureTransportChargeCode } from "@/lib/transport/config"
import { BOOKING_STATUS_LABELS, LIVE_BOOKING_STATUSES } from "@/lib/transport/constants"
import { rateAmount, selectRate, taxOverrideFor } from "@/lib/transport/pricing"
import { bookingCreateSchema, bookingStatusSchema, bookingUpdateSchema } from "@/lib/transport/schemas"
import { addDaysKey, dateKeyToDate, dateToKey, localToUtc, utcToLocal } from "@/lib/transport/time"

// Transport bookings — one guest party's transfer in one direction (PICKUP = arrival,
// DROP_OFF = departure), linked to a reservation (0..n per reservation) or standalone (a
// local traveller with no stay, billed on a walk-in folio — the same non-reservation
// billing Excursions and Fast Post use). Shared by the desk routes and the Booking API.
//
// Prices are snapshotted on the booking (amount, charge code, tax mode) when it is priced,
// so what Night Audit posts never changes under it because a rate was edited later.

type Tx = Prisma.TransactionClient

const placeSelect = { select: { id: true, code: true, name: true, type: true } } as const

export const BOOKING_INCLUDE = {
  reservation: {
    select: {
      id: true,
      confirmationNo: true,
      status: true,
      checkInDate: true,
      checkOutDate: true,
      assignments: { select: { startDate: true, room: { select: { roomNumber: true } } }, orderBy: { startDate: "asc" as const } },
    },
  },
  groupBlock: { select: { id: true, code: true, name: true } },
  airportRep: { select: { id: true, firstName: true, lastName: true } },
  route: { include: { origin: placeSelect, destination: placeSelect, transportType: { select: { id: true, requiresFlightDetails: true } } } },
  transportType: { select: { id: true, code: true, name: true, mode: true, requiresFlightDetails: true } },
  provider: { select: { id: true, name: true, kind: true, phone: true } },
  vessel: { select: { id: true, name: true, capacity: true } },
  manifest: {
    include: {
      provider: { select: { id: true, name: true, kind: true, phone: true } },
      vessel: { select: { id: true, name: true, capacity: true } },
    },
  },
  folioLineItem: {
    select: {
      id: true,
      folioId: true,
      isVoid: true,
      amount: true,
      taxAmount: true,
      serviceChargeAmount: true,
      generatedLines: { select: { amount: true, taxAmount: true, serviceChargeAmount: true, isVoid: true } },
    },
  },
} satisfies Prisma.TransportBookingInclude

export type BookingRow = Prisma.TransportBookingGetPayload<{ include: typeof BOOKING_INCLUDE }>

const round2 = (n: number) => Math.round(n * 100) / 100

export function bookingReference(id: string): string {
  return `TR-${id.slice(0, 6).toUpperCase()}`
}

/** The billing status as it really stands: a POSTED line voided on the folio reads VOIDED. */
export function effectiveBillingStatus(b: Pick<BookingRow, "billingStatus" | "folioLineItem">): string {
  if (b.billingStatus === "POSTED" && b.folioLineItem?.isVoid) return "VOIDED"
  return b.billingStatus
}

export type BookingView = ReturnType<typeof serializeBooking>

type Place = { id: string; code: string; name: string; type: string }
/** The leg's real start and end: a BOTH route is stored arrival-wise, so a drop-off reverses it. */
export function legEnds(route: { direction: string; origin: Place; destination: Place }, direction: string): { from: Place; to: Place } {
  return direction === "DROP_OFF" && route.direction === "BOTH"
    ? { from: route.destination, to: route.origin }
    : { from: route.origin, to: route.destination }
}

export function serializeBooking(b: BookingRow, opts: { timeZone: string; toleranceMinutes: number }) {
  const tz = opts.timeZone
  const local = (d: Date | null | undefined) => (d ? utcToLocal(d, tz) : null)
  const effectiveDeparture = b.manifest && b.manifest.status !== "CANCELLED" ? b.manifest.departureAt : b.departureAt
  const provider = b.provider ?? b.manifest?.provider ?? null
  const vessel = b.vessel ?? b.manifest?.vessel ?? null
  const needsFlight =
    b.route?.category === "AIRPORT_TRANSFER" || !!b.transportType?.requiresFlightDetails || !!b.route?.transportType.requiresFlightDetails
  const attention: AttentionReason[] = attentionFor({
    direction: b.direction,
    status: b.status,
    flightAt: b.flightAt,
    flightNo: b.flightNo,
    departureAt: effectiveDeparture,
    durationMinutes: b.route?.durationMinutes ?? null,
    toleranceMinutes: opts.toleranceMinutes,
    onManifest: !!b.manifestId,
    flightAtOnManifest: b.flightAtOnManifest,
    needsFlight,
  })
  const line = b.folioLineItem
  const postedGross = line
    ? round2(
        line.amount +
          line.taxAmount +
          line.serviceChargeAmount +
          line.generatedLines.filter((g) => !g.isVoid).reduce((s, g) => s + g.amount + g.taxAmount + g.serviceChargeAmount, 0)
      )
    : null
  const room = b.reservation?.assignments.find((a) => a.room)?.room?.roomNumber ?? null
  return {
    id: b.id,
    reference: bookingReference(b.id),
    propertyId: b.propertyId,
    reservationId: b.reservationId,
    reservation: b.reservation
      ? {
          id: b.reservation.id,
          confirmationNo: b.reservation.confirmationNo,
          status: b.reservation.status,
          checkInDate: dateToKey(b.reservation.checkInDate),
          checkOutDate: dateToKey(b.reservation.checkOutDate),
          roomNumber: room,
        }
      : null,
    groupBlock: b.groupBlock,
    guestName: b.guestName,
    guestContact: b.guestContact,
    folioId: b.folioId,
    direction: b.direction,
    status: b.status,
    serviceDate: dateToKey(b.serviceDate),
    adults: b.adults,
    children: b.children,
    infants: b.infants,
    pax: b.adults + b.children + b.infants,
    notes: b.notes,
    airline: b.airline,
    flightNo: b.flightNo,
    flightAt: b.flightAt?.toISOString() ?? null,
    flightLocal: local(b.flightAt),
    terminal: b.terminal,
    airportRep: b.airportRep ? { id: b.airportRep.id, name: `${b.airportRep.firstName} ${b.airportRep.lastName}`.trim() } : null,
    meetingNotes: b.meetingNotes,
    needsFlight,
    route: b.route
      ? {
          id: b.route.id,
          code: b.route.code,
          name: b.route.name,
          category: b.route.category,
          durationMinutes: b.route.durationMinutes,
          instructions: b.route.instructions,
          origin: b.route.origin,
          destination: b.route.destination,
          // Where this leg actually goes: a route for both directions is entered the arrival
          // way round (airport → property), so a drop-off travels it in reverse.
          ...legEnds(b.route, b.direction),
        }
      : null,
    transportType: b.transportType,
    /** The booking's own departure (before any manifest). */
    departureAt: b.departureAt?.toISOString() ?? null,
    /** The departure that applies: the manifest's once attached. */
    effectiveDepartureAt: effectiveDeparture?.toISOString() ?? null,
    departureLocal: local(effectiveDeparture),
    manifest: b.manifest
      ? {
          id: b.manifest.id,
          status: b.manifest.status,
          departureAt: b.manifest.departureAt.toISOString(),
          departureLocal: utcToLocal(b.manifest.departureAt, tz),
        }
      : null,
    provider,
    vessel,
    isOwn: provider ? provider.kind === "OWN" : null,
    driverName: b.driverName ?? b.manifest?.driverName ?? null,
    driverContact: b.driverContact ?? b.manifest?.driverContact ?? null,
    seatNote: b.seatNote,
    pricing: {
      rateId: b.rateId,
      amount: b.amount,
      vehicleCount: b.vehicleCount,
      priceOverridden: b.priceOverridden,
      overrideReason: b.overrideReason,
      chargeCodeId: b.chargeCodeId,
      taxMode: b.taxMode,
    },
    billing: {
      status: effectiveBillingStatus(b),
      folioLineItemId: b.folioLineItemId,
      folioId: line?.folioId ?? null,
      postedAt: b.postedAt?.toISOString() ?? null,
      postedGross,
      note: b.billingNote,
    },
    attention,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancellationReason: b.cancellationReason,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }
}

async function viewOpts(propertyId: string) {
  const [p, s] = await Promise.all([propertyTz(propertyId), prisma.transportSettings.findUnique({ where: { propertyId } })])
  return { timeZone: p.timeZone, toleranceMinutes: s?.attentionToleranceMinutes ?? 60 }
}

export async function getBooking(propertyId: string, id: string): Promise<BookingView> {
  const b = await prisma.transportBooking.findFirst({ where: { id, propertyId }, include: BOOKING_INCLUDE })
  if (!b) throw notFound("Transport booking")
  return serializeBooking(b, await viewOpts(propertyId))
}

// ── Listing ────────────────────────────────────────────────────────────────────────────

export type BookingFilters = {
  from?: string | null
  to?: string | null
  direction?: string | null
  status?: string[] | null
  reservationId?: string | null
  manifestId?: string | null
  transportTypeId?: string | null
  routeId?: string | null
  providerId?: string | null
  airportRepUserId?: string | null
  groupBlockId?: string | null
  flightNo?: string | null
  search?: string | null
  unassignedOnly?: boolean
  attentionOnly?: boolean
  includeCancelled?: boolean
  limit?: number
  cursor?: string | null
}

export async function listBookings(propertyId: string, f: BookingFilters = {}) {
  const where: Prisma.TransportBookingWhereInput = { propertyId }
  if (f.from || f.to) {
    where.serviceDate = {
      ...(f.from ? { gte: dateKeyToDate(f.from) } : {}),
      ...(f.to ? { lt: dateKeyToDate(addDaysKey(f.to, 1)) } : {}),
    }
  }
  if (f.direction) where.direction = f.direction
  if (f.status?.length) where.status = { in: f.status }
  else if (!f.includeCancelled && !f.reservationId) where.status = { not: "CANCELLED" }
  if (f.reservationId) where.reservationId = f.reservationId
  if (f.manifestId) where.manifestId = f.manifestId
  if (f.transportTypeId) where.transportTypeId = f.transportTypeId
  if (f.routeId) where.routeId = f.routeId
  if (f.providerId) where.OR = [{ providerId: f.providerId }, { manifest: { providerId: f.providerId } }]
  if (f.airportRepUserId) where.airportRepUserId = f.airportRepUserId
  if (f.groupBlockId) where.groupBlockId = f.groupBlockId
  if (f.flightNo) where.flightNo = { contains: f.flightNo.replace(/\s+/g, ""), mode: "insensitive" }
  if (f.unassignedOnly) where.manifestId = null
  if (f.search) {
    const q = f.search.trim()
    where.AND = [
      {
        OR: [
          { guestName: { contains: q, mode: "insensitive" } },
          { flightNo: { contains: q.replace(/\s+/g, ""), mode: "insensitive" } },
          { reservation: { confirmationNo: { contains: q, mode: "insensitive" } } },
          { groupBlock: { code: { contains: q, mode: "insensitive" } } },
          { groupBlock: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
    ]
  }
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 500)
  const rows = await prisma.transportBooking.findMany({
    where,
    include: BOOKING_INCLUDE,
    orderBy: [{ serviceDate: "asc" }, { departureAt: "asc" }, { flightAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  })
  const opts = await viewOpts(propertyId)
  const page = rows.slice(0, limit).map((b) => serializeBooking(b, opts))
  const items = f.attentionOnly ? page.filter((b) => b.attention.length > 0) : page
  return { items, nextCursor: rows.length > limit ? rows[limit - 1].id : null }
}

// ── Pricing ────────────────────────────────────────────────────────────────────────────

type PricingInput = {
  routeId: string | null
  direction: string
  serviceDate: Date
  transportTypeId: string | null
  providerId: string | null
  adults: number
  children: number
  infants: number
  vehicleCount: number
}

export type Pricing = {
  rateId: string | null
  amount: number | null
  chargeCodeId: string | null
  taxMode: string
  taxProfileId: string | null
  billable: boolean
  priceOverridden: boolean
  overrideReason: string | null
}

export async function resolvePricing(
  propertyId: string,
  input: PricingInput,
  settings: TransportSettingsValues,
  override?: { amount: number; reason: string } | null
): Promise<Pricing> {
  const rates = input.routeId
    ? await prisma.transportRate.findMany({ where: { propertyId, routeId: input.routeId, isActive: true } })
    : []
  const rate = input.routeId
    ? selectRate(rates, {
        routeId: input.routeId,
        direction: input.direction,
        serviceDate: input.serviceDate,
        transportTypeId: input.transportTypeId,
        providerId: input.providerId,
      })
    : null
  if (override) {
    const chargeCodeId = rate?.chargeCodeId ?? settings.defaultChargeCodeId ?? (await ensureTransportChargeCode(propertyId)).id
    return {
      rateId: rate?.id ?? null,
      amount: round2(override.amount),
      chargeCodeId,
      taxMode: rate?.taxMode ?? settings.defaultTaxMode,
      taxProfileId: rate ? rate.taxProfileId : settings.defaultTaxProfileId,
      billable: override.amount > 0,
      priceOverridden: true,
      overrideReason: override.reason,
    }
  }
  if (!rate) {
    return { rateId: null, amount: null, chargeCodeId: null, taxMode: settings.defaultTaxMode, taxProfileId: null, billable: false, priceOverridden: false, overrideReason: null }
  }
  const amount = rateAmount(rate, { adults: input.adults, children: input.children, infants: input.infants }, input.vehicleCount)
  return {
    rateId: rate.id,
    amount,
    chargeCodeId: rate.chargeCodeId,
    taxMode: rate.taxMode,
    taxProfileId: rate.taxProfileId,
    billable: rate.isBillable && amount > 0,
    priceOverridden: false,
    overrideReason: null,
  }
}

/** What a price comes to on the folio — the real posting engine, rolled back. */
export async function previewAmount(
  propertyId: string,
  p: { amount: number | null; chargeCodeId: string | null; taxMode: string; taxProfileId: string | null }
): Promise<ChargePreview | null> {
  if (p.amount == null || !p.chargeCodeId || p.amount <= 0) return null
  const [code, settings, property, taxProfile] = await Promise.all([
    prisma.chargeCode.findFirst({ where: { id: p.chargeCodeId, propertyId }, include: chargeCodeInclude() }),
    getPropertySettings(propertyId),
    propertyTz(propertyId),
    p.taxMode === "CUSTOM" && p.taxProfileId
      ? prisma.taxProfile.findFirst({ where: { id: p.taxProfileId, propertyId }, include: { rates: true } })
      : null,
  ])
  if (!code) return null
  return previewCharge(propertyId, {
    chargeCode: code,
    inputAmount: p.amount,
    settings,
    pricesIncludeTaxes: property.pricesIncludeTaxes,
    date: property.businessDate ?? new Date(),
    outlet: taxOverrideFor(p.taxMode, taxProfile),
  })
}

/** Quote for the booking form: the rate that would apply, its amount and the folio total. */
export async function quoteBooking(propertyId: string, body: unknown) {
  const settings = await assertTransportEnabled(propertyId)
  const parsed = bookingUpdateSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const v = parsed.data
  const serviceDate = v.serviceDate ? dateKeyToDate(v.serviceDate) : new Date()
  const pricing = await resolvePricing(
    propertyId,
    {
      routeId: v.routeId ?? null,
      direction: v.direction ?? "PICKUP",
      serviceDate,
      transportTypeId: v.transportTypeId ?? null,
      providerId: v.providerId ?? null,
      adults: v.adults ?? 1,
      children: v.children ?? 0,
      infants: v.infants ?? 0,
      vehicleCount: v.vehicleCount ?? 1,
    },
    settings,
    v.priceOverride ?? null
  )
  const rate = pricing.rateId
    ? await prisma.transportRate.findUnique({ where: { id: pricing.rateId }, select: { id: true, name: true, pricingBasis: true, isBillable: true, childMinAge: true, childMaxAge: true } })
    : null
  return { ...pricing, rate, preview: pricing.billable ? await previewAmount(propertyId, pricing) : null }
}

// ── Create / update ────────────────────────────────────────────────────────────────────

async function assertOwned(propertyId: string, refs: { routeId?: string | null; transportTypeId?: string | null; providerId?: string | null; vesselId?: string | null; airportRepUserId?: string | null }, enterpriseId: string) {
  const checks: Promise<unknown>[] = []
  const fail = (what: string) => {
    throw invalid(`${what} not found at this property`, "INVALID_REFERENCE")
  }
  if (refs.routeId) checks.push(prisma.transportRoute.findFirst({ where: { id: refs.routeId, propertyId } }).then((r) => r || fail("Route")))
  if (refs.transportTypeId) checks.push(prisma.transportType.findFirst({ where: { id: refs.transportTypeId, propertyId } }).then((r) => r || fail("Transport type")))
  if (refs.providerId) checks.push(prisma.transportProvider.findFirst({ where: { id: refs.providerId, propertyId } }).then((r) => r || fail("Provider")))
  if (refs.vesselId) checks.push(prisma.transportVessel.findFirst({ where: { id: refs.vesselId, propertyId } }).then((r) => r || fail("Vessel")))
  if (refs.airportRepUserId) {
    // Any active staff user of this enterprise who works here (or across all properties).
    checks.push(
      prisma.user
        .findFirst({
          where: {
            id: refs.airportRepUserId,
            enterpriseId,
            isActive: true,
            isSystem: false,
            OR: [{ scope: "ENTERPRISE" }, { propertyId }],
          },
        })
        .then((r) => r || fail("Airport rep"))
    )
  }
  await Promise.all(checks)
}

function guestNameOf(p: { firstName: string; lastName: string | null; companyName: string | null; title?: string | null }) {
  return p.companyName && !p.lastName ? p.companyName : `${p.firstName} ${p.lastName ?? ""}`.trim()
}

/**
 * The older per-reservation Transport card (ReservationTransport, one leg per direction) is
 * superseded where Transportation is on. Making a booking for a reservation+direction that
 * still has an old leg CONVERTS it: its flight details fill any the booking left empty, and
 * if Night Audit or an Advance Bill already charged it, the booking takes over that posted
 * line — so the transfer is never charged twice. The old leg is then removed.
 */
async function takeOverLegacyLeg(tx: Tx, reservationId: string, direction: string) {
  const legacyDir = direction === "DROP_OFF" ? "DROPOFF" : "PICKUP"
  const leg = await tx.reservationTransport.findUnique({ where: { reservationId_direction: { reservationId, direction: legacyDir } } })
  if (!leg) return null
  await tx.reservationTransport.delete({ where: { id: leg.id } })
  return leg
}

export async function createBooking(actor: TransportActor, propertyId: string, body: unknown): Promise<BookingView> {
  const settings = await assertTransportEnabled(propertyId)
  const parsed = bookingCreateSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const v = parsed.data
  const property = await propertyTz(propertyId)
  const tz = property.timeZone

  let reservation: Prisma.ReservationGetPayload<{ include: { primaryGuest: { include: { communications: true } } } }> | null = null
  if (v.reservationId) {
    reservation = await prisma.reservation.findFirst({
      where: { id: v.reservationId, propertyId },
      include: { primaryGuest: { include: { communications: true } } },
    })
    if (!reservation) throw notFound("Reservation")
    if (reservation.status === "CANCELLED" || reservation.status === "NO_SHOW") {
      throw invalid(`This reservation is ${reservation.status === "CANCELLED" ? "cancelled" : "a no-show"} — transport can't be added to it.`, "RESERVATION_CLOSED")
    }
  } else if (!v.guestName) {
    throw invalid("A standalone transfer needs the traveller's name (or link it to a reservation).", "GUEST_REQUIRED")
  }

  if (v.priceOverride && !actor.canBill) throw forbidden("Setting a price by hand needs the Transportation billing permission")
  await assertOwned(propertyId, v, property.enterpriseId)

  const serviceDateKey =
    v.serviceDate ?? (reservation ? dateToKey(v.direction === "PICKUP" ? reservation.checkInDate : reservation.checkOutDate) : null)
  if (!serviceDateKey) throw invalid("serviceDate is required")
  const serviceDate = dateKeyToDate(serviceDateKey)

  let transportTypeId = v.transportTypeId ?? null
  if (v.routeId && !transportTypeId) {
    transportTypeId = (await prisma.transportRoute.findUnique({ where: { id: v.routeId }, select: { transportTypeId: true } }))?.transportTypeId ?? null
  }

  const adults = v.adults ?? reservation?.adults ?? 1
  const children = v.children ?? reservation?.children ?? 0
  const infants = v.infants ?? reservation?.infants ?? 0
  if (adults + children + infants < 1) throw invalid("At least one passenger")
  const vehicleCount = v.vehicleCount ?? 1
  const pricing = await resolvePricing(
    propertyId,
    { routeId: v.routeId ?? null, direction: v.direction, serviceDate, transportTypeId, providerId: v.providerId ?? null, adults, children, infants, vehicleCount },
    settings,
    v.priceOverride ?? null
  )

  const guestName = v.guestName ?? (reservation ? guestNameOf(reservation.primaryGuest) : "")
  const contact =
    v.guestContact ??
    reservation?.primaryGuest.communications.find((c) => c.type === "MOBILE" && c.isPrimary)?.value ??
    reservation?.primaryGuest.communications.find((c) => c.type === "MOBILE")?.value ??
    null

  const created = await prisma.$transaction(async (tx) => {
    const legacy = reservation ? await takeOverLegacyLeg(tx, reservation.id, v.direction) : null
    const flightDateKey = v.flightDate ?? serviceDateKey
    let flightAt = v.flightTime ? localToUtc(flightDateKey, v.flightTime, tz) : null
    let flightNo = v.flightNo ?? null
    if (legacy && !flightAt && legacy.carrierTime) flightAt = legacy.carrierTime
    if (legacy && !flightNo && legacy.carrierCode) flightNo = legacy.carrierCode
    const legacyLineFree =
      legacy?.chargedLineItemId &&
      !(await tx.transportBooking.findUnique({ where: { folioLineItemId: legacy.chargedLineItemId }, select: { id: true } }))

    const booking = await tx.transportBooking.create({
      data: {
        propertyId,
        reservationId: reservation?.id ?? null,
        groupBlockId: reservation?.groupBlockId ?? null,
        guestName,
        guestContact: contact,
        direction: v.direction,
        status: v.status,
        serviceDate,
        adults,
        children,
        infants,
        notes: v.notes ?? (legacy?.remarks || null),
        airline: v.airline,
        flightNo,
        flightAt,
        terminal: v.terminal,
        airportRepUserId: v.airportRepUserId,
        meetingNotes: v.meetingNotes,
        routeId: v.routeId,
        transportTypeId,
        departureAt: v.departureTime ? localToUtc(serviceDateKey, v.departureTime, tz) : (legacy?.transportTime ?? null),
        providerId: v.providerId,
        vesselId: v.vesselId,
        driverName: v.driverName,
        driverContact: v.driverContact,
        seatNote: v.seatNote ?? (legacy?.transportNo || null),
        vehicleCount,
        rateId: pricing.rateId,
        amount: pricing.amount,
        priceOverridden: pricing.priceOverridden,
        overrideReason: pricing.overrideReason,
        chargeCodeId: pricing.chargeCodeId,
        taxMode: pricing.taxMode,
        taxProfileId: pricing.taxProfileId,
        // A converted leg that was already charged keeps its charge: the booking owns it now.
        ...(legacyLineFree
          ? { billingStatus: "POSTED", folioLineItemId: legacy!.chargedLineItemId, postedAt: new Date(), billingNote: "Charged by the earlier Transport card" }
          : { billingStatus: pricing.billable ? "NOT_BILLED" : "NON_BILLABLE" }),
        createdByUserId: actor.userId,
      },
    })
    return { booking, legacy }
  })

  await logActivity({
    ctx: actor.ctx,
    module: "TRANSPORTATION",
    action: "CREATE",
    entityType: "TransportBooking",
    entityId: created.booking.id,
    description: `Transport ${v.direction === "PICKUP" ? "pickup" : "drop-off"} ${bookingReference(created.booking.id)} for ${guestName} on ${serviceDateKey}${reservation ? ` (${reservation.confirmationNo})` : ""}${v.status === "DRAFT" ? " — draft" : ""}${pricing.priceOverridden ? ` — price set by hand ${pricing.amount?.toFixed(2)}: ${pricing.overrideReason}` : ""}${created.legacy ? " — converted from the earlier Transport card" : ""}`,
    metadata: { propertyId, source: actor.source, amount: pricing.amount, rateId: pricing.rateId },
  })
  return getBooking(propertyId, created.booking.id)
}

const LOCKED_BILLING = new Set(["POSTED", "WAIVED"])

export async function updateBooking(actor: TransportActor, propertyId: string, id: string, body: unknown): Promise<BookingView> {
  const settings = await assertTransportEnabled(propertyId)
  const parsed = bookingUpdateSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const v = parsed.data
  const existing = await prisma.transportBooking.findFirst({ where: { id, propertyId } })
  if (!existing) throw notFound("Transport booking")
  if (existing.status === "CANCELLED") throw invalid("A cancelled booking can't be edited — reinstate it first.", "BOOKING_CANCELLED")
  if (v.priceOverride !== undefined && !actor.canBill) throw forbidden("Setting a price by hand needs the Transportation billing permission")
  const property = await propertyTz(propertyId)
  const tz = property.timeZone
  await assertOwned(propertyId, v, property.enterpriseId)
  if (v.guestName !== undefined && !v.guestName && !existing.reservationId) throw invalid("A standalone transfer needs the traveller's name.")

  const serviceDateKey = v.serviceDate ?? dateToKey(existing.serviceDate)
  const serviceDate = dateKeyToDate(serviceDateKey)
  const data: Prisma.TransportBookingUncheckedUpdateInput = {}
  const set = <K extends keyof typeof v>(k: K, col: keyof Prisma.TransportBookingUncheckedUpdateInput = k as never) => {
    if (v[k] !== undefined) (data as Record<string, unknown>)[col as string] = v[k]
  }
  set("direction")
  set("notes")
  set("airline")
  set("flightNo")
  set("terminal")
  set("airportRepUserId")
  set("meetingNotes")
  set("routeId")
  set("transportTypeId")
  set("providerId")
  set("vesselId")
  set("driverName")
  set("driverContact")
  set("seatNote")
  set("adults")
  set("children")
  set("infants")
  set("vehicleCount")
  set("guestContact")
  if (v.guestName) data.guestName = v.guestName
  if (v.serviceDate) data.serviceDate = serviceDate

  // Flight: a new time on the flight's own day (defaults to the service day).
  if (v.flightTime !== undefined || v.flightDate !== undefined) {
    const time = v.flightTime !== undefined ? v.flightTime : existing.flightAt ? utcToLocal(existing.flightAt, tz).time : null
    const dayKey = v.flightDate ?? (existing.flightAt ? utcToLocal(existing.flightAt, tz).dateKey : serviceDateKey)
    data.flightAt = time ? localToUtc(dayKey, time, tz) : null
  }
  if (v.departureTime !== undefined || (v.serviceDate && existing.departureAt)) {
    const time = v.departureTime !== undefined ? v.departureTime : existing.departureAt ? utcToLocal(existing.departureAt, tz).time : null
    data.departureAt = time ? localToUtc(serviceDateKey, time, tz) : null
  }
  if (v.routeId && v.transportTypeId === undefined && !existing.transportTypeId) {
    data.transportTypeId = (await prisma.transportRoute.findUnique({ where: { id: v.routeId }, select: { transportTypeId: true } }))?.transportTypeId ?? null
  }
  const next = { ...existing, ...data } as typeof existing
  if (next.adults + next.children + next.infants < 1) throw invalid("At least one passenger")

  // Re-price while the charge is still open: an explicit override, or any change that the
  // rate depends on (unless a hand-set price is being kept).
  const pricingTouched = ["routeId", "transportTypeId", "providerId", "direction", "serviceDate", "adults", "children", "infants", "vehicleCount"].some(
    (k) => (v as Record<string, unknown>)[k] !== undefined
  )
  let repriced: Pricing | null = null
  if (!LOCKED_BILLING.has(existing.billingStatus) && (v.priceOverride !== undefined || (pricingTouched && !existing.priceOverridden))) {
    const override =
      v.priceOverride === undefined
        ? null
        : v.priceOverride
    repriced = await resolvePricing(
      propertyId,
      {
        routeId: next.routeId,
        direction: next.direction,
        serviceDate: next.serviceDate,
        transportTypeId: next.transportTypeId,
        providerId: next.providerId,
        adults: next.adults,
        children: next.children,
        infants: next.infants,
        vehicleCount: next.vehicleCount,
      },
      settings,
      override
    )
    Object.assign(data, {
      rateId: repriced.rateId,
      amount: repriced.amount,
      priceOverridden: repriced.priceOverridden,
      overrideReason: repriced.overrideReason,
      chargeCodeId: repriced.chargeCodeId,
      taxMode: repriced.taxMode,
      taxProfileId: repriced.taxProfileId,
      billingStatus: repriced.billable ? (existing.billingStatus === "PENDING" ? "PENDING" : "NOT_BILLED") : "NON_BILLABLE",
    })
  } else if (v.priceOverride !== undefined && LOCKED_BILLING.has(existing.billingStatus)) {
    throw invalid("The charge has already been posted or waived — adjust it on the folio instead.", "BILLING_LOCKED")
  }

  // A rescheduled booking leaves a departure on another day.
  if (v.serviceDate && existing.manifestId) {
    const m = await prisma.transportManifest.findUnique({ where: { id: existing.manifestId }, select: { serviceDate: true, direction: true } })
    if (m && (dateToKey(m.serviceDate) !== serviceDateKey || (v.direction && v.direction !== m.direction))) {
      data.manifestId = null
      data.flightAtOnManifest = null
      if (existing.status === "ASSIGNED") data.status = "CONFIRMED"
    }
  }

  await prisma.transportBooking.update({ where: { id }, data })
  await logActivity({
    ctx: actor.ctx,
    module: "TRANSPORTATION",
    action: "UPDATE",
    entityType: "TransportBooking",
    entityId: id,
    description: `Updated transport booking ${bookingReference(id)} (${existing.guestName})${repriced?.priceOverridden && v.priceOverride ? ` — price set by hand ${repriced.amount?.toFixed(2)}: ${repriced.overrideReason}` : ""}`,
    metadata: { propertyId, source: actor.source, changed: Object.keys(v) },
  })
  return getBooking(propertyId, id)
}

// ── Status ─────────────────────────────────────────────────────────────────────────────

const ALLOWED: Record<string, string[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["ASSIGNED", "COMPLETED", "NO_SHOW", "CANCELLED"],
  ASSIGNED: ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"],
  COMPLETED: ["CONFIRMED", "ASSIGNED", "NO_SHOW"],
  NO_SHOW: ["CONFIRMED", "ASSIGNED", "COMPLETED"],
  CANCELLED: ["CONFIRMED"],
}

export async function applyBookingStatus(
  tx: Tx,
  booking: { id: string; status: string; providerId: string | null; manifestId: string | null; manifest?: { providerId: string | null } | null },
  status: string,
  settings: TransportSettingsValues,
  reason?: string | null
) {
  if (booking.status === status) return false
  if (!ALLOWED[booking.status]?.includes(status)) {
    throw invalid(
      `A ${BOOKING_STATUS_LABELS[booking.status as keyof typeof BOOKING_STATUS_LABELS] ?? booking.status} booking can't become ${BOOKING_STATUS_LABELS[status as keyof typeof BOOKING_STATUS_LABELS] ?? status}.`,
      "INVALID_STATUS_CHANGE"
    )
  }
  if (settings.requireProvider && (status === "ASSIGNED" || status === "COMPLETED") && !booking.providerId && !booking.manifest?.providerId) {
    throw invalid("Assign a provider first — this property requires one.", "PROVIDER_REQUIRED")
  }
  const data: Prisma.TransportBookingUncheckedUpdateInput = { status }
  if (status === "CANCELLED") {
    // A cancelled booking leaves its departure, so it no longer counts as a seat.
    Object.assign(data, { cancelledAt: new Date(), cancellationReason: reason ?? null, manifestId: null, flightAtOnManifest: null })
  } else if (booking.status === "CANCELLED") {
    Object.assign(data, { cancelledAt: null, cancellationReason: null })
  }
  if (status === "ASSIGNED" && !booking.manifestId && !booking.providerId) {
    throw invalid("Add the booking to a departure or choose a provider to assign it.", "NOTHING_ASSIGNED")
  }
  await tx.transportBooking.update({ where: { id: booking.id }, data })
  return true
}

export async function setBookingStatus(actor: TransportActor, propertyId: string, id: string, body: unknown) {
  const settings = await assertTransportEnabled(propertyId)
  const parsed = bookingStatusSchema.safeParse(body ?? {})
  if (!parsed.success) throw fromZod(parsed.error)
  const { status, reason } = parsed.data
  const b = await prisma.transportBooking.findFirst({ where: { id, propertyId }, include: { manifest: { select: { providerId: true } } } })
  if (!b) throw notFound("Transport booking")
  const changed = await prisma.$transaction((tx) => applyBookingStatus(tx, b, status, settings, reason))
  if (changed) {
    await logActivity({
      ctx: actor.ctx,
      module: "TRANSPORTATION",
      action: status === "CANCELLED" ? "CANCEL" : status === "NO_SHOW" ? "NO_SHOW" : "STATUS",
      entityType: "TransportBooking",
      entityId: id,
      description: `Transport booking ${bookingReference(id)} (${b.guestName}): ${b.status} → ${status}${reason ? ` — ${reason}` : ""}`,
      metadata: { propertyId, source: actor.source },
    })
  }
  const view = await getBooking(propertyId, id)
  // Cancelling or no-showing a charged booking never voids it automatically — the folio's
  // void (or a manual waive) is the deliberate next step, said plainly to the caller.
  const note =
    (status === "CANCELLED" || status === "NO_SHOW") && view.billing.status === "POSTED"
      ? "The transfer charge is still on the folio. Void it from the booking or the folio if it should not be charged."
      : (status === "CANCELLED" || status === "NO_SHOW") && ["NOT_BILLED", "PENDING"].includes(view.billing.status)
        ? "Night Audit will not post this transfer. Use Post charge for a cancellation or no-show fee."
        : null
  return { booking: view, note }
}

// ── Suggestions (never auto-confirmed) ─────────────────────────────────────────────────

/**
 * Reservations arriving or departing in [from, to] that have no transport booking in that
 * direction yet — offered as DRAFT bookings for the desk to review. Nothing is created here.
 */
export async function transportSuggestions(propertyId: string, from: string, to: string) {
  await assertTransportEnabled(propertyId)
  const gte = dateKeyToDate(from)
  const lt = dateKeyToDate(addDaysKey(to, 1))
  const reservations = await prisma.reservation.findMany({
    where: {
      propertyId,
      status: { in: ["RESERVED", "IN_HOUSE"] },
      OR: [{ checkInDate: { gte, lt } }, { checkOutDate: { gte, lt } }],
    },
    include: {
      primaryGuest: { select: { firstName: true, lastName: true, companyName: true } },
      groupBlock: { select: { id: true, code: true, name: true } },
      transportBookings: { where: { status: { not: "CANCELLED" } }, select: { direction: true } },
      transports: true,
    },
    orderBy: { checkInDate: "asc" },
    take: 500,
  })
  const out: {
    reservationId: string
    confirmationNo: string
    guestName: string
    direction: "PICKUP" | "DROP_OFF"
    serviceDate: string
    pax: number
    groupBlock: { id: string; code: string; name: string } | null
    flightNo: string | null
  }[] = []
  for (const r of reservations) {
    const has = new Set(r.transportBookings.map((b) => b.direction))
    const legacy = (dir: string) => r.transports.find((t) => t.direction === dir)
    const push = (direction: "PICKUP" | "DROP_OFF", date: Date) => {
      if (has.has(direction) || date < gte || date >= lt) return
      out.push({
        reservationId: r.id,
        confirmationNo: r.confirmationNo,
        guestName: guestNameOf(r.primaryGuest),
        direction,
        serviceDate: dateToKey(date),
        pax: r.adults + r.children + r.infants,
        groupBlock: r.groupBlock,
        flightNo: legacy(direction === "PICKUP" ? "PICKUP" : "DROPOFF")?.carrierCode ?? null,
      })
    }
    if (r.status === "RESERVED") push("PICKUP", r.checkInDate)
    push("DROP_OFF", r.checkOutDate)
  }
  return out.sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))
}

/** Create DRAFT bookings for chosen suggestions. Skips any that already got a booking. */
export async function createDraftsFromSuggestions(
  actor: TransportActor,
  propertyId: string,
  items: { reservationId: string; direction: "PICKUP" | "DROP_OFF" }[]
) {
  let created = 0
  let skipped = 0
  for (const it of items.slice(0, 200)) {
    const exists = await prisma.transportBooking.findFirst({
      where: { propertyId, reservationId: it.reservationId, direction: it.direction, status: { not: "CANCELLED" } },
      select: { id: true },
    })
    if (exists) {
      skipped++
      continue
    }
    try {
      await createBooking(actor, propertyId, { reservationId: it.reservationId, direction: it.direction, status: "DRAFT" })
      created++
    } catch (e) {
      if (e instanceof BookingError) skipped++
      else throw e
    }
  }
  return { created, skipped }
}

export { LIVE_BOOKING_STATUSES }
