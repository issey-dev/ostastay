import type { Prisma } from "@prisma/client"
import { postCharge } from "@/lib/posting/post-charge"
import type { GenerateRow } from "@/lib/posting/run-generates"
import { applyRateAdjustment } from "@/lib/derived-rate"
import { allocationAmountForNight } from "@/lib/allocations"
import { nextBusinessDate } from "@/lib/business-date"
import { GREEN_TAX_GUEST_SELECT, greenTaxPax, reservationGuests } from "@/lib/green-tax-exemption"

// One stay-night's charges for one reservation — the nightly room charge (and through its
// generates Service Charge, GST, Green Tax), the extra-occupancy surcharge and the night's
// allocations. Moved out of Night Audit (run.ts) so a late arrival's HELD night can be
// charged at check-in through exactly the same pricing and posting (owner, 2026-09-24):
// the audit posts tonight's night; check-in posts a night that was audited before the
// guest arrived.

type PostChargeInput = Parameters<typeof postCharge>[1]
type ChargeCodeForPosting = PostChargeInput["chargeCode"]

const taxInclude = { taxProfile: { include: { rates: true } } } as const

/** What a reservation must be loaded with for postStayNight. */
export const STAY_NIGHT_INCLUDE = {
  folios: { where: { isClosed: false } },
  // The named guests, for Green Tax per person: exempt ones come off the head count.
  primaryGuest: { select: GREEN_TAX_GUEST_SELECT },
  accompanyingGuests: { select: { profile: { select: GREEN_TAX_GUEST_SELECT } } },
  assignments: {
    orderBy: { startDate: "desc" },
    include: {
      roomType: true,
      // "Charge as" room type (kept-rate room move) — pricing resolves off this when set.
      chargeRoomType: true,
      ratePlan: { include: { chargeCode: { include: taxInclude } } },
    },
  },
  // The materialized allocation set (see ReservationAllocation) — each with its
  // allocation's rates and charge code (incl. tax profile) for posting.
  allocations: {
    include: {
      allocation: {
        include: {
          rates: true,
          chargeCode: { include: taxInclude },
        },
      },
    },
  },
} satisfies Prisma.ReservationInclude

export type StayNightReservation = Prisma.ReservationGetPayload<{ include: typeof STAY_NIGHT_INCLUDE }>

export type StayNightContext = {
  settings: PostChargeInput["settings"]
  pricesIncludeTaxes: boolean
  /** The property's ACCOMMODATION code — used when the rate plan carries none. */
  fallbackRoomCode: ChargeCodeForPosting
  /** The property's locked Base Rate plan: the price when the rate plan has none. */
  baseRatePlan: { id: string } | null
  /** See run.ts — Green Tax on an accommodation code that carries no row of its own. */
  impliedGreenTaxGenerate: GenerateRow[]
  /** EnterpriseSettings.greenTaxExemptAge — under it at check-in a guest is an infant. */
  greenTaxExemptAge?: number
  /** Folio a charge on this code lands on (standing routing rules), else the default. */
  routeTo: (reservationId: string, chargeCodeId: string, defaultFolioId: string) => string
}

export type StayNightResult = { roomRevenue: number; taxPosted: number; postings: number; zeroRate: boolean }

/**
 * Post the charges for the stay-night `night` on `folioId`, dated `postDate`.
 *
 * `levyNightly` false leaves out the per-person nightly levies (Green Tax): a held night
 * the guest was not there for is charged for the room, but they were not staying.
 */
export async function postStayNight(
  tx: Prisma.TransactionClient,
  res: StayNightReservation,
  {
    night,
    postDate,
    folioId,
    description = "Nightly Room Charge",
    levyNightly = true,
  }: { night: Date; postDate: Date; folioId: string; description?: string; levyNightly?: boolean },
  ctx: StayNightContext
): Promise<StayNightResult | null> {
  const activeAssignment = res.assignments[0]
  if (!activeAssignment) return null
  const { settings, pricesIncludeTaxes, routeTo } = ctx
  // Green Tax is per person: the named guests who are exempt (infant, Maldivian, permit
  // holder, ticked) come off the head count. Other per-person charges keep the full count.
  const greenTaxBasis = () => {
    const pax = greenTaxPax(res, reservationGuests(res), ctx.greenTaxExemptAge ?? 2)
    return { greenTaxAdults: pax.adults, greenTaxChildren: pax.children }
  }

  // Derived Rate Plans read PriceCalendar under their PARENT's id — they have no
  // rows of their own (see src/lib/derived-rate.ts) — then the adjustment is
  // applied below to whatever price results, including the Base Rate plan
  // fallback, so a derived plan is always "parent price + adjustment" no matter
  // where the parent's price actually came from.
  const activeRatePlan = activeAssignment.ratePlan
  const isDerivedRatePlan = !!activeRatePlan.parentRatePlanId
  const calendarRatePlanId = isDerivedRatePlan ? activeRatePlan.parentRatePlanId! : activeAssignment.ratePlanId
  // Price against the "charge as" room type when set (kept-rate move), else the
  // physical room type. Governs the PriceCalendar lookup AND base occupancy below.
  const chargeRoomTypeId = activeAssignment.chargeRoomTypeId ?? activeAssignment.roomTypeId
  const chargeRoomType = activeAssignment.chargeRoomType ?? activeAssignment.roomType

  // Room charge posts against the rate plan's own accommodation code when set,
  // else the property fallback.
  const roomCode = activeRatePlan.chargeCode ?? ctx.fallbackRoomCode

  const nightRange = { gte: night, lt: nextBusinessDate(night) }

  // Fetched unconditionally (not just when overrideRate is unset) since extra-
  // occupancy surcharges are a separate additive charge tied to the night's calendar
  // entry — a manual base-rate override shouldn't silently suppress them.
  const calendarEntry = await tx.priceCalendar.findFirst({
    where: { ratePlanId: calendarRatePlanId, roomTypeId: chargeRoomTypeId, date: nightRange },
  })

  let zeroRate = false
  let inputAmount = activeAssignment.overrideRate
  if (inputAmount == null) {
    let baseRoomPrice = calendarEntry?.price
    // No entry under the assigned (or derived-from) plan — fall back to the
    // property's locked Base Rate plan's own Price Calendar entry for the night
    // (skip the extra lookup if that's already what we just checked above).
    if (baseRoomPrice == null && ctx.baseRatePlan && calendarRatePlanId !== ctx.baseRatePlan.id) {
      const baseCalendarEntry = await tx.priceCalendar.findFirst({
        where: { ratePlanId: ctx.baseRatePlan.id, roomTypeId: chargeRoomTypeId, date: nightRange },
      })
      baseRoomPrice = baseCalendarEntry?.price
    }
    if (baseRoomPrice == null) zeroRate = true
    baseRoomPrice = baseRoomPrice ?? 0
    if (isDerivedRatePlan) {
      baseRoomPrice = applyRateAdjustment(baseRoomPrice, activeRatePlan.derivedAdjustmentType!, activeRatePlan.derivedAdjustmentValue!)
    }
    inputAmount = baseRoomPrice
  }

  // Resolve the night's allocation postings (see src/lib/allocations.ts — the same
  // rhythm/date-range/pax math the reservation form previews with). Attached rows
  // post regardless of the allocation's current isActive — deactivation only stops
  // NEW attachments; a guest who booked breakfast still gets billed for it.
  const allocationsTonight: Array<{ reservationAllocation: (typeof res.allocations)[number]; grossInput: number }> = []
  for (const ra of res.allocations) {
    const amount = allocationAmountForNight({
      allocation: ra.allocation,
      adults: res.adults,
      children: res.children,
      checkInDate: res.checkInDate,
      checkOutDate: res.checkOutDate,
      auditDate: night,
      overrideAdultPrice: ra.overrideAdultPrice,
      overrideChildPrice: ra.overrideChildPrice,
    })
    if (amount != null && amount > 0) {
      allocationsTonight.push({ reservationAllocation: ra, grossInput: amount })
    }
  }

  // INCLUDE_IN_RATE allocations are carved OUT of the room line before it is
  // tax-resolved — folio total unchanged, revenue attribution moves to the
  // allocation's charge code. Clamped at zero: allocations can never push the
  // room line negative (the allocation lines still post in full).
  const includeInRateGross = allocationsTonight
    .filter((a) => a.reservationAllocation.allocation.mode === "INCLUDE_IN_RATE")
    .reduce((sum, a) => sum + a.grossInput, 0)
  const roomInputAfterCarveOut = Math.max(0, inputAmount - includeInRateGross)

  let roomRevenue = 0
  let taxPosted = 0
  let postings = 0

  // The nightly room charge — and, through its generate rows, the night's Green Tax
  // and any other levy the property has declared on this code.
  const roomPosting = await postCharge(tx, {
    folioId: routeTo(res.id, roomCode.id, folioId),
    chargeCode: roomCode,
    inputAmount: roomInputAfterCarveOut,
    settings,
    pricesIncludeTaxes,
    date: postDate,
    description,
    roomAssignmentId: activeAssignment.id,
    // One stay-night. Infants are deliberately absent — exempt, and not counted. With no
    // headcount a per-person levy produces nothing — how a held night skips Green Tax.
    postingContext: levyNightly ? { adults: res.adults, children: res.children, nights: 1, ...greenTaxBasis() } : undefined,
    extraGenerates: levyNightly ? ctx.impliedGreenTaxGenerate : [],
    routeGeneratedTo: (chargeCodeId) => routeTo(res.id, chargeCodeId, folioId),
  })

  roomRevenue += roomPosting.baseAmount
  // taxTotal already covers this charge's Service Charge and GST wherever they
  // landed — in the parent's columns, or on their own routed tax lines. Levies
  // (Green Tax and friends) are additional tax collected, never room revenue.
  taxPosted += roomPosting.taxTotal + roomPosting.leviesTotal
  postings += 1 + roomPosting.generated.length

  // Extra-occupancy surcharge — adults beyond RoomType.baseOccupancy at the night's
  // calendar extraAdultPrice, plus every child at extraChildPrice (no "included
  // children" baseline, same convention as Green Tax). Both rates are optional per
  // PriceCalendar day (no RoomType-level fallback), so this is a no-op unless the
  // property has actually configured them for the night.
  const extraAdults = Math.max(0, res.adults - chargeRoomType.baseOccupancy)
  const extraOccupancyInput =
    extraAdults * (calendarEntry?.extraAdultPrice ?? 0) + res.children * (calendarEntry?.extraChildPrice ?? 0)

  if (extraOccupancyInput > 0) {
    const parts = []
    if (extraAdults > 0) parts.push(`${extraAdults} extra adult${extraAdults > 1 ? "s" : ""}`)
    if (res.children > 0) parts.push(`${res.children} child${res.children > 1 ? "ren" : ""}`)

    // Generates run here too — this line must carry its own Service Charge and
    // GST like any other accommodation revenue. What it deliberately does NOT
    // pass is a postingContext: the nightly per-person levies (Green Tax) were
    // already levied on the room line for this same night, and a levy needs a
    // headcount basis to produce an amount, so it correctly contributes nothing
    // here rather than double-charging the night.
    const extraOccupancy = await postCharge(tx, {
      folioId: routeTo(res.id, roomCode.id, folioId),
      chargeCode: roomCode,
      inputAmount: extraOccupancyInput,
      settings,
      pricesIncludeTaxes,
      date: postDate,
      description: `Extra Occupancy Charge (${parts.join(", ")})`,
      roomAssignmentId: activeAssignment.id,
      routeGeneratedTo: (chargeCodeId) => routeTo(res.id, chargeCodeId, folioId),
    })

    roomRevenue += extraOccupancy.baseAmount
    taxPosted += extraOccupancy.taxTotal + extraOccupancy.leviesTotal
    postings += 1 + extraOccupancy.generated.length
  }

  // The night's allocations (Breakfast, Transfers, Spa... — see
  // .agents/docs/ALLOCATIONS_PLAN.md). Each posts against its own charge code
  // through the same tax engine; INCLUDE_IN_RATE ones were already carved out of
  // the room line above, ADD_TO_RATE/SELL_SEPARATE ones are purely additive.
  // (A meal plan's per-person pricing arrives here via its linked allocations —
  // materialized on the reservation at booking time, not re-resolved live.)
  for (const { reservationAllocation: ra, grossInput } of allocationsTonight) {
    const alloc = ra.allocation

    const paxParts = []
    if (res.adults > 0) paxParts.push(`${res.adults} adult${res.adults > 1 ? "s" : ""}`)
    if (res.children > 0) paxParts.push(`${res.children} child${res.children > 1 ? "ren" : ""}`)

    const allocPosting = await postCharge(tx, {
      folioId: routeTo(res.id, alloc.chargeCodeId, folioId),
      chargeCode: alloc.chargeCode,
      inputAmount: grossInput,
      settings,
      pricesIncludeTaxes,
      date: postDate,
      description: `${alloc.name} (${paxParts.join(", ")})`,
      postingContext: levyNightly ? { adults: res.adults, children: res.children, nights: 1, ...greenTaxBasis() } : undefined,
      routeGeneratedTo: (chargeCodeId) => routeTo(res.id, chargeCodeId, folioId),
    })

    taxPosted += allocPosting.taxTotal + allocPosting.leviesTotal
    postings += 1 + allocPosting.generated.length
  }

  return { roomRevenue, taxPosted, postings, zeroRate }
}
