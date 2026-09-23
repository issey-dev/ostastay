import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertPropertyModuleAccess, hasPermission, type AuthContext } from "@/lib/scope";
import { resolvePaymentChargeCodeId } from "@/lib/posting/post-payment";
import { postCharge, chargeCodeInclude } from "@/lib/posting/post-charge";
import { previewCharge, type ChargePreview } from "@/lib/posting/preview-charge";
import { voidPostedCharge, actorDisplayName } from "@/lib/posting/void-charge";
import { resolveBusinessDate } from "@/lib/business-date";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { rateForDate, computeBookingTotal, combineDepartureDateTime } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";
import { lockKeys, lockKey, BOOKING_TX_OPTIONS } from "@/lib/db-lock";
import { BookingError } from "@/lib/booking-error";

// The ONE place an ExcursionBooking is created, priced and cancelled. Shared by the desk's
// session routes and the public Booking API (BOOKING_API_ADDONS_PLAN.md Phases 0 and 2),
// the same reason createReservation is the one path for rooms: a seat is sold, priced and
// posted identically whoever sells it.
//
// Guests: an in-house reservation (billed to their open room folio), an already-open
// walk-in folio (the desk's flow — POST /api/folios/walk-in first), or a NEW walk-in whose
// folio is opened inside the booking transaction (the Booking API — online guests are
// never linked to a stay, owner 2026-09-23). Billing always flows through postCharge,
// routed via the hub-wide Excursion Outlet.
//
// Seats: capacity counts CONFIRMED bookings AND live Booking API holds
// (ApiActivityBooking status HELD, holdExpiresAt in the future), so a website guest who is
// paying keeps their seat against the desk as well.

export type ExcursionGuest =
  | { kind: "RESERVATION"; reservationId: string }
  | { kind: "WALK_IN_FOLIO"; folioId: string }
  | { kind: "NEW_WALK_IN"; name: string; contact: string | null };

export type ExcursionParty = { adultCount: number; childCount: number; infantCount: number };

type BookingTx = Prisma.TransactionClient;
type CreatedBooking = Prisma.ExcursionBookingGetPayload<{ include: typeof bookingInclude }>;

export type CreateExcursionBookingInput = ExcursionParty & {
  departureId: string;
  guest: ExcursionGuest;
  notes?: string | null;
  /** Settle the posted gross in the same transaction — "charge & pay now" at the desk
   *  (in-house only), or a booking the website reports as PAID (new walk-in). */
  settlement?: { paymentMethodId: string; referenceNumber: string | null } | null;
  source?: "DESK" | "API";
  /** A Booking API hold being converted: its seats are this booking's, not a competitor's. */
  consumeHoldId?: string | null;
  /** Runs inside the booking transaction, under the departure lock, after the booking is
   *  written — the Booking API records its own row here so the two commit together. */
  onCreated?: (tx: BookingTx, booking: CreatedBooking, posted: { grandTotal: number }) => Promise<void>;
};

const bookingInclude = {
  departure: { include: { excursionType: true } },
  reservation: { include: { primaryGuest: true } },
} as const;

export function headcountLabel(adults: number, children: number, infants: number): string {
  return [
    adults ? `${adults} adult${adults === 1 ? "" : "s"}` : null,
    children ? `${children} child${children === 1 ? "" : "ren"}` : null,
    infants ? `${infants} infant${infants === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Where the Booking API's live holds on a departure are (see ApiActivityBooking). */
export function activeHoldWhere(departureId: string, now = new Date(), excludeHoldId?: string | null) {
  return {
    excursionDepartureId: departureId,
    status: "HELD",
    holdExpiresAt: { gt: now },
    ...(excludeHoldId ? { id: { not: excludeHoldId } } : {}),
  };
}

/**
 * Seats taken on a departure: CONFIRMED bookings plus live Booking API holds. Call inside
 * the departure lock when the answer decides whether a booking may be written.
 */
export async function occupiedSeats(
  client: Pick<typeof prisma, "excursionBooking" | "apiActivityBooking">,
  departureId: string,
  opts: { excludeHoldId?: string | null; now?: Date } = {}
): Promise<number> {
  const [booked, held] = await Promise.all([
    client.excursionBooking.aggregate({
      where: { departureId, status: "CONFIRMED" },
      _sum: { adultCount: true, childCount: true, infantCount: true },
    }),
    client.apiActivityBooking.aggregate({
      where: activeHoldWhere(departureId, opts.now, opts.excludeHoldId),
      _sum: { adults: true, children: true, infants: true },
    }),
  ]);
  return (
    (booked._sum.adultCount ?? 0) +
    (booked._sum.childCount ?? 0) +
    (booked._sum.infantCount ?? 0) +
    (held._sum.adults ?? 0) +
    (held._sum.children ?? 0) +
    (held._sum.infants ?? 0)
  );
}

function assertParty(party: ExcursionParty) {
  const requested = party.adultCount + party.childCount + party.infantCount;
  // Every booking must carry at least one guest — a 0-headcount booking would post a $0
  // charge and consume a manifest slot for nobody.
  if (party.adultCount < 0 || party.childCount < 0 || party.infantCount < 0 || requested <= 0) {
    throw new BookingError(400, "INVALID_PARTY", "At least one guest is required to book.");
  }
  return requested;
}

export function assertDepartureOpen(departure: { status: string; departureDate: Date; departureTime: string }) {
  if (departure.status !== "SCHEDULED") {
    throw new BookingError(400, "DEPARTURE_CLOSED", "This departure is no longer taking bookings");
  }
  // Nothing auto-transitions a departure's status after it sails, so SCHEDULED alone
  // isn't enough. (A15)
  if (combineDepartureDateTime(departure.departureDate, departure.departureTime) < new Date()) {
    throw new BookingError(400, "DEPARTURE_CLOSED", "This departure has already left and can no longer be booked.");
  }
}

/**
 * Everything pricing a departure needs: the departure, the rate for its date, the
 * enterprise settings with the Excursion Outlet, and the postable charge code. Shared by
 * quoting and booking so both price with identical inputs.
 */
async function loadPricing(departureId: string) {
  const departure = await prisma.excursionDeparture.findUnique({
    where: { id: departureId },
    include: { excursionType: { include: { rates: true, property: true } } },
  });
  if (!departure) throw new BookingError(404, "DEPARTURE_NOT_FOUND", "Departure not found");
  const { excursionType } = departure;
  const rate = rateForDate(excursionType.rates, departure.departureDate);
  const settings = await prisma.enterpriseSettings.findUnique({
    where: { enterpriseId: excursionType.property.enterpriseId },
    include: { excursionOutlet: { include: { taxProfile: { include: { rates: true } } } } },
  });
  return { departure, excursionType, rate, settings, outlet: settings?.excursionOutlet ?? null };
}

function requireRateAndOutlet(p: Awaited<ReturnType<typeof loadPricing>>) {
  if (!p.rate) throw new BookingError(400, "NO_RATE", "No price is configured for this departure's date");
  // An excursion booking ALWAYS posts its charge, so no outlet means no booking at all
  // (owner rule 2026-07-30).
  if (!p.outlet) {
    throw new BookingError(
      400,
      "NO_OUTLET",
      "No Excursion Outlet is linked — link one under Controls > Excursions (it applies to every property) before posting excursion charges."
    );
  }
  return { rate: p.rate, outlet: p.outlet };
}

function postingInput(p: Awaited<ReturnType<typeof loadPricing>>, party: ExcursionParty, totalAmount: number, description: string) {
  return {
    inputAmount: totalAmount,
    settings: p.settings,
    pricesIncludeTaxes: p.excursionType.property.pricesIncludeTaxes,
    date: resolveBusinessDate(p.excursionType.property),
    description,
    outlet: p.outlet,
    outletId: p.outlet?.id ?? null,
    // Headcount so a per-person levy on this code has a basis. Infants are excluded for
    // the same reason they are on a stay night — they are exempt.
    postingContext: { adults: party.adultCount, children: party.childCount, nights: 1 },
  };
}

function chargeDescription(p: Awaited<ReturnType<typeof loadPricing>>, party: ExcursionParty) {
  return `${p.excursionType.name} — ${headcountLabel(party.adultCount, party.childCount, party.infantCount)} (${p.departure.departureDate
    .toISOString()
    .slice(0, 10)} ${p.departure.departureTime})`;
}

export type ExcursionQuote = {
  departureId: string;
  excursionTypeId: string;
  party: ExcursionParty;
  /** The rate-card amount before the tax engine (what postCharge is given). */
  priceBeforeTax: number;
  charge: ChargePreview;
  currency: string;
  pricesIncludeTaxes: boolean;
};

/**
 * What booking this party on this departure would cost, computed by the very posting code
 * the booking uses (previewCharge). Writes nothing.
 */
export async function quoteExcursion(departureId: string, party: ExcursionParty): Promise<ExcursionQuote> {
  assertParty(party);
  const p = await loadPricing(departureId);
  const { rate } = requireRateAndOutlet(p);
  const priceBeforeTax = computeBookingTotal(rate, p.excursionType.pricingMode, party);
  const code = await prisma.chargeCode.findUniqueOrThrow({ where: { id: p.excursionType.chargeCodeId }, include: chargeCodeInclude() });
  const charge = await previewCharge(p.excursionType.propertyId, {
    chargeCode: code,
    ...postingInput(p, party, priceBeforeTax, chargeDescription(p, party)),
  });
  return {
    departureId,
    excursionTypeId: p.excursionType.id,
    party,
    priceBeforeTax,
    charge,
    currency: p.excursionType.property.defaultCurrency,
    pricesIncludeTaxes: p.excursionType.property.pricesIncludeTaxes,
  };
}

export async function createExcursionBooking(ctx: AuthContext, input: CreateExcursionBookingInput) {
  const { departureId, guest } = input;
  const party: ExcursionParty = { adultCount: input.adultCount, childCount: input.childCount, infantCount: input.infantCount };
  const requested = assertParty(party);

  const p = await loadPricing(departureId);
  const { excursionType, departure } = p;
  await assertPropertyModuleAccess(ctx, excursionType.propertyId, "EXCURSIONS");

  // Fast-fail checks, repeated authoritatively under the lock below.
  assertDepartureOpen(departure);

  let folioIdToCharge: string | null = null;
  let bookingIdentity: { reservationId: string | null; walkInGuestName: string | null; walkInGuestContact: string | null };
  let activityGuestLabel: string;

  if (guest.kind === "RESERVATION") {
    // In-house guest: a reservation at THIS property with an open folio.
    const reservation = await prisma.reservation.findUnique({
      where: { id: guest.reservationId },
      include: { folios: { where: { isClosed: false } }, primaryGuest: true },
    });
    if (!reservation || reservation.propertyId !== excursionType.propertyId) {
      throw new BookingError(404, "RESERVATION_NOT_FOUND", "Reservation not found at this property");
    }
    // In-house bookings must fall WITHIN the guest's stay — the charge is realized on
    // their room folio. An out-of-stay departure should be booked as a walk-in instead.
    const dayMs = (d: Date | string) => { const x = new Date(d); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };
    const depMs = dayMs(departure.departureDate);
    if (depMs < dayMs(reservation.checkInDate) || depMs > dayMs(reservation.checkOutDate)) {
      throw new BookingError(
        400,
        "OUTSIDE_STAY",
        "This departure is outside the guest's stay. Book within their stay dates, or use the walk-in option.",
        { outsideStay: true }
      );
    }
    const folio = reservation.folios[0];
    if (!folio) throw new BookingError(400, "NO_OPEN_FOLIO", "This guest has no open folio to bill the excursion to");
    folioIdToCharge = folio.id;
    bookingIdentity = { reservationId: reservation.id, walkInGuestName: null, walkInGuestContact: null };
    activityGuestLabel = `${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName ?? ""}`.trim();
  } else if (guest.kind === "WALK_IN_FOLIO") {
    // Walk-in: an OPEN, reservation-less folio at this property — never a reservation's
    // own folio smuggled in through this param.
    const folio = await prisma.folio.findUnique({ where: { id: guest.folioId } });
    if (!folio || folio.propertyId !== excursionType.propertyId) {
      throw new BookingError(404, "FOLIO_NOT_FOUND", "Folio not found at this property");
    }
    if (folio.reservationId) {
      throw new BookingError(400, "FOLIO_IS_RESERVATION", "This folio belongs to a reservation — use reservationId instead");
    }
    if (folio.isClosed) throw new BookingError(400, "FOLIO_CLOSED", "This walk-in bill is already closed");
    folioIdToCharge = folio.id;
    bookingIdentity = { reservationId: null, walkInGuestName: folio.walkInGuestName, walkInGuestContact: folio.walkInGuestContact };
    activityGuestLabel = folio.walkInGuestName || "Walk-in guest";
  } else {
    // New walk-in: the folio is opened inside the booking transaction, so a refused
    // booking leaves no empty bill behind.
    const name = guest.name.trim();
    if (!name) throw new BookingError(400, "VALIDATION", "The guest's name is required");
    bookingIdentity = { reservationId: null, walkInGuestName: name, walkInGuestContact: guest.contact };
    activityGuestLabel = name;
  }

  let settlement: { paymentMethodId: string; referenceNumber: string | null } | null = null;
  if (input.settlement) {
    if (guest.kind === "WALK_IN_FOLIO") {
      throw new BookingError(400, "SETTLEMENT_NOT_ALLOWED", "Pay-now settlement is only available for in-house guests.");
    }
    const method = await prisma.paymentMethod.findUnique({ where: { id: input.settlement.paymentMethodId } });
    if (!method || method.enterpriseId !== ctx.enterpriseId) {
      throw new BookingError(404, "PAYMENT_METHOD_NOT_FOUND", "Payment method not found");
    }
    settlement = { paymentMethodId: method.id, referenceNumber: input.settlement.referenceNumber };
  }

  const { rate } = requireRateAndOutlet(p);
  const totalAmount = computeBookingTotal(rate, excursionType.pricingMode, party);
  const postableCode = await prisma.chargeCode.findUniqueOrThrow({
    where: { id: excursionType.chargeCodeId },
    include: chargeCodeInclude(),
  });

  const label = headcountLabel(party.adultCount, party.childCount, party.infantCount);
  // Attribute the posting to the caller's open cashier drawer so it shows in their shift
  // summary. Opened before the transaction: it is its own idempotent upsert.
  const shift = await ensureOpenShift(ctx, excursionType.propertyId);

  const booking = await prisma.$transaction(async (tx) => {
    // Serialize every booking for this departure, then re-check under the lock: status
    // (a concurrent whole-departure cancel), departure time, and capacity. A departure's
    // capacity is a hard boat/tour limit, not a soft preference.
    await lockKeys(tx, [lockKey.excursionDeparture(departureId)]);
    const current = await tx.excursionDeparture.findUniqueOrThrow({ where: { id: departureId } });
    assertDepartureOpen(current);
    const taken = await occupiedSeats(tx, departureId, { excludeHoldId: input.consumeHoldId });
    if (taken + requested > current.capacity) {
      const remaining = Math.max(0, current.capacity - taken);
      throw new BookingError(
        400,
        "SOLD_OUT",
        `This departure only has ${remaining} seat${remaining === 1 ? "" : "s"} left (capacity ${current.capacity}).`,
        { seatsLeft: remaining }
      );
    }

    const folioId =
      folioIdToCharge ??
      (
        await tx.folio.create({
          data: {
            propertyId: excursionType.propertyId,
            folioNumber: 1,
            walkInGuestName: bookingIdentity.walkInGuestName,
            walkInGuestContact: bookingIdentity.walkInGuestContact,
          },
        })
      ).id;

    const posted = await postCharge(tx, {
      folioId,
      chargeCode: postableCode,
      shiftId: shift.id,
      ...postingInput(p, party, totalAmount, `${excursionType.name} — ${label} (${departure.departureDate.toISOString().slice(0, 10)} ${departure.departureTime})`),
    });

    // Settle the WHOLE posting (charge plus every line it generated), so this booking's
    // folio impact is zero.
    if (settlement) {
      await tx.payment.create({
        data: {
          folioId,
          paymentMethodId: settlement.paymentMethodId,
          shiftId: shift.id,
          chargeCodeId: await resolvePaymentChargeCodeId(tx, settlement.paymentMethodId),
          amount: posted.grandTotal,
          referenceNumber: settlement.referenceNumber,
        },
      });
    }

    const created = await tx.excursionBooking.create({
      data: {
        departureId,
        propertyId: excursionType.propertyId,
        ...bookingIdentity,
        ...party,
        totalAmount,
        folioId,
        folioLineItemId: posted.parent.id,
        bookedByUserId: ctx.userId,
        notes: input.notes || null,
        source: input.source ?? "DESK",
      },
      include: bookingInclude,
    });
    if (input.onCreated) await input.onCreated(tx, created, { grandTotal: posted.grandTotal });
    return created;
  }, BOOKING_TX_OPTIONS);

  await logActivity({
    ctx,
    module: "EXCURSIONS",
    action: "CREATE",
    entityType: "ExcursionBooking",
    entityId: booking.id,
    description: `Booked ${excursionType.name} for ${label} — ${activityGuestLabel}${input.source === "API" ? " (online)" : ""}`,
  });

  return booking;
}

// ---------------------------------------------------------------------------------------
// Cancellation

export type ExcursionAuthority = {
  /** EXCURSIONS delete — cancel past the cutoff. */
  canOverride: boolean;
  /** CASHIERING update — void the posted charge. */
  canVoid: boolean;
};

export function excursionAuthorityFor(ctx: AuthContext): ExcursionAuthority {
  return { canOverride: hasPermission(ctx, "EXCURSIONS", "delete"), canVoid: hasPermission(ctx, "CASHIERING", "update") };
}

/** When the free-cancellation window for a booking closes. */
export function cancelDeadline(departure: { departureDate: Date; departureTime: string }, cutoffHours: number): Date {
  const departureAt = combineDepartureDateTime(departure.departureDate, departure.departureTime);
  return new Date(departureAt.getTime() - cutoffHours * 3_600_000);
}

/**
 * Cancels a CONFIRMED booking. Two independent gates, not one:
 *  - the cutoff (ExcursionType.cutoffHours before departure): past it, only an actor with
 *    the override may cancel;
 *  - voiding the posted charge needs `canVoid` and an open folio. Without either the seat is
 *    still freed and the result says what cashiering must do — cancelling a seat and
 *    touching money are different trust levels. A closed folio is a finalized document:
 *    any refund then happens outside the system.
 */
export async function cancelExcursionBooking(
  ctx: AuthContext,
  id: string,
  input: { reason: string },
  authority: ExcursionAuthority
) {
  const reason = input.reason.trim();
  if (!reason) throw new BookingError(400, "VALIDATION", "A reason is required to cancel a booking");

  const booking = await prisma.excursionBooking.findUnique({
    where: { id },
    include: { departure: { include: { excursionType: true } }, folioLineItem: true },
  });
  if (!booking) throw new BookingError(404, "BOOKING_NOT_FOUND", "Booking not found");
  await assertPropertyModuleAccess(ctx, booking.propertyId, "EXCURSIONS");

  if (booking.status !== "CONFIRMED") {
    throw new BookingError(400, "ALREADY_CANCELLED", `Cannot cancel a booking with status ${booking.status}`);
  }
  const cutoffHours = booking.departure.excursionType.cutoffHours;
  if (new Date() > cancelDeadline(booking.departure, cutoffHours) && !authority.canOverride) {
    throw new BookingError(
      403,
      "CANCEL_CUTOFF_PASSED",
      `Past the ${cutoffHours}-hour cancellation cutoff — a manager override is required`
    );
  }

  const folio = booking.folioLineItemId ? await prisma.folio.findUnique({ where: { id: booking.folioId } }) : null;
  const canVoid = !!booking.folioLineItem && !booking.folioLineItem.isVoid && !!folio && !folio.isClosed;
  const willVoid = canVoid && authority.canVoid;

  await prisma.$transaction(async (tx) => {
    // Status flips only if nobody else moved it first (desk and website at once).
    const { count } = await tx.excursionBooking.updateMany({
      where: { id, status: "CONFIRMED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason },
    });
    if (count === 0) throw new BookingError(409, "ALREADY_CANCELLED", "This booking was already cancelled");
    if (willVoid && booking.folioLineItemId) {
      await voidPostedCharge(tx, {
        lineItemId: booking.folioLineItemId,
        reason: `Excursion cancelled: ${reason}`,
        actorName: await actorDisplayName(tx, ctx.userId),
      });
    }
  });

  let chargeNote: string;
  if (!booking.folioLineItemId) chargeNote = "No charge was posted for this booking.";
  else if (willVoid) chargeNote = "The posted charge was voided.";
  else if (folio?.isClosed) chargeNote = "The bill is already closed — any refund must be handled manually.";
  else chargeNote = "The charge was left in place — cashiering access is required to void it.";

  await logActivity({
    ctx,
    module: "EXCURSIONS",
    action: "UPDATE",
    entityType: "ExcursionBooking",
    entityId: id,
    description: `Cancelled ${booking.departure.excursionType.name} booking — ${reason}. ${chargeNote}`,
  });

  return { chargeVoided: willVoid, chargeNote };
}
