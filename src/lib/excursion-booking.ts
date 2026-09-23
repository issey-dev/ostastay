import { prisma } from "@/lib/db";
import { assertPropertyModuleAccess, type AuthContext } from "@/lib/scope";
import { resolvePaymentChargeCodeId } from "@/lib/posting/post-payment";
import { postCharge, chargeCodeInclude } from "@/lib/posting/post-charge";
import { resolveBusinessDate } from "@/lib/business-date";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { rateForDate, computeBookingTotal, combineDepartureDateTime } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";
import { lockKeys, lockKey, BOOKING_TX_OPTIONS } from "@/lib/db-lock";
import { BookingError } from "@/lib/booking-error";

// The ONE place an ExcursionBooking is created. Extracted from
// POST /api/excursions/bookings (BOOKING_API_ADDONS_PLAN.md Phase 0 §2) so the desk and
// the public Booking API can never drift in how a seat is sold, priced or posted — the
// same reason createReservation is the one path for rooms.
//
// Books a departure for either an in-house guest (billed to their existing open room
// folio) or a walk-in (an already-open walk-in folio — POST /api/folios/walk-in — whose
// identity is read off the folio rather than re-entered). Billing always flows through
// postCharge, routed via the hub-wide Excursion Outlet.

export type ExcursionGuest =
  | { kind: "RESERVATION"; reservationId: string }
  | { kind: "WALK_IN_FOLIO"; folioId: string };

export type CreateExcursionBookingInput = {
  departureId: string;
  guest: ExcursionGuest;
  adultCount: number;
  childCount: number;
  infantCount: number;
  notes?: string | null;
  /** "Charge & pay now" — in-house only; settles the posted gross in the same transaction. */
  settlement?: { paymentMethodId: string; referenceNumber: string | null } | null;
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

/** CONFIRMED headcount on a departure. Call inside the departure lock when the answer
 *  decides whether a booking may be written. */
export async function bookedHeadcount(
  client: Pick<typeof prisma, "excursionBooking">,
  departureId: string
): Promise<number> {
  const booked = await client.excursionBooking.aggregate({
    where: { departureId, status: "CONFIRMED" },
    _sum: { adultCount: true, childCount: true, infantCount: true },
  });
  return (booked._sum.adultCount ?? 0) + (booked._sum.childCount ?? 0) + (booked._sum.infantCount ?? 0);
}

export async function createExcursionBooking(ctx: AuthContext, input: CreateExcursionBookingInput) {
  const { departureId, guest, adultCount, childCount, infantCount } = input;
  const requested = adultCount + childCount + infantCount;
  // Every booking must carry at least one guest — a 0-headcount booking would post a $0
  // charge and consume a manifest slot for nobody.
  if (adultCount < 0 || childCount < 0 || infantCount < 0 || requested <= 0) {
    throw new BookingError(400, "INVALID_PARTY", "At least one guest is required to book.");
  }

  const departure = await prisma.excursionDeparture.findUnique({
    where: { id: departureId },
    include: { excursionType: { include: { rates: true, property: true } } },
  });
  if (!departure) throw new BookingError(404, "DEPARTURE_NOT_FOUND", "Departure not found");
  const { excursionType } = departure;
  await assertPropertyModuleAccess(ctx, excursionType.propertyId, "EXCURSIONS");

  // Fast-fail checks, repeated authoritatively under the lock below.
  assertDepartureOpen(departure);

  let folioIdToCharge: string;
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
  } else {
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
  }

  let settlement: { paymentMethodId: string; referenceNumber: string | null } | null = null;
  if (input.settlement) {
    if (guest.kind !== "RESERVATION") {
      throw new BookingError(400, "SETTLEMENT_NOT_ALLOWED", "Pay-now settlement is only available for in-house guests.");
    }
    const method = await prisma.paymentMethod.findUnique({ where: { id: input.settlement.paymentMethodId } });
    if (!method || method.enterpriseId !== ctx.enterpriseId) {
      throw new BookingError(404, "PAYMENT_METHOD_NOT_FOUND", "Payment method not found");
    }
    settlement = { paymentMethodId: method.id, referenceNumber: input.settlement.referenceNumber };
  }

  const rate = rateForDate(excursionType.rates, departure.departureDate);
  if (!rate) throw new BookingError(400, "NO_RATE", "No price is configured for this departure's date");
  const totalAmount = computeBookingTotal(rate, excursionType.pricingMode, { adultCount, childCount, infantCount });

  const settings = await prisma.enterpriseSettings.findUnique({
    where: { enterpriseId: excursionType.property.enterpriseId },
    include: { excursionOutlet: { include: { taxProfile: { include: { rates: true } } } } },
  });
  // The hub-wide Excursion Outlet — an excursion booking ALWAYS posts its charge, so no
  // outlet means no booking at all (owner rule 2026-07-30).
  const excursionOutlet = settings?.excursionOutlet ?? null;
  if (!excursionOutlet) {
    throw new BookingError(
      400,
      "NO_OUTLET",
      "No Excursion Outlet is linked — link one under Controls > Excursions (it applies to every property) before posting excursion charges."
    );
  }
  const postableCode = await prisma.chargeCode.findUniqueOrThrow({
    where: { id: excursionType.chargeCodeId },
    include: chargeCodeInclude(),
  });

  const label = headcountLabel(adultCount, childCount, infantCount);
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
    const booked = await bookedHeadcount(tx, departureId);
    if (booked + requested > current.capacity) {
      const remaining = Math.max(0, current.capacity - booked);
      throw new BookingError(
        400,
        "SOLD_OUT",
        `This departure only has ${remaining} seat${remaining === 1 ? "" : "s"} left (capacity ${current.capacity}).`,
        { seatsLeft: remaining }
      );
    }

    const posted = await postCharge(tx, {
      folioId: folioIdToCharge,
      chargeCode: postableCode,
      inputAmount: totalAmount,
      settings,
      pricesIncludeTaxes: excursionType.property.pricesIncludeTaxes,
      date: resolveBusinessDate(excursionType.property),
      description: `${excursionType.name} — ${label} (${departure.departureDate.toISOString().slice(0, 10)} ${departure.departureTime})`,
      outlet: excursionOutlet,
      outletId: excursionOutlet.id,
      shiftId: shift.id,
      // Headcount so a per-person levy on this code has a basis. Infants are excluded
      // for the same reason they are on a stay night — they are exempt.
      postingContext: { adults: adultCount, children: childCount, nights: 1 },
    });

    // Charge & pay now: settle the WHOLE posting (charge plus every line it generated),
    // so this booking's folio impact is zero.
    if (settlement) {
      await tx.payment.create({
        data: {
          folioId: folioIdToCharge,
          paymentMethodId: settlement.paymentMethodId,
          shiftId: shift.id,
          chargeCodeId: await resolvePaymentChargeCodeId(tx, settlement.paymentMethodId),
          amount: posted.grandTotal,
          referenceNumber: settlement.referenceNumber,
        },
      });
    }

    return tx.excursionBooking.create({
      data: {
        departureId,
        propertyId: excursionType.propertyId,
        ...bookingIdentity,
        adultCount,
        childCount,
        infantCount,
        totalAmount,
        folioId: folioIdToCharge,
        folioLineItemId: posted.parent.id,
        bookedByUserId: ctx.userId,
        notes: input.notes || null,
      },
      include: bookingInclude,
    });
  }, BOOKING_TX_OPTIONS);

  await logActivity({
    ctx,
    module: "EXCURSIONS",
    action: "CREATE",
    entityType: "ExcursionBooking",
    entityId: booking.id,
    description: `Booked ${excursionType.name} for ${label} — ${activityGuestLabel}`,
  });

  return booking;
}

function assertDepartureOpen(departure: { status: string; departureDate: Date; departureTime: string }) {
  if (departure.status !== "SCHEDULED") {
    throw new BookingError(400, "DEPARTURE_CLOSED", "This departure is no longer taking bookings");
  }
  // Nothing auto-transitions a departure's status after it sails, so SCHEDULED alone
  // isn't enough. (A15)
  if (combineDepartureDateTime(departure.departureDate, departure.departureTime) < new Date()) {
    throw new BookingError(400, "DEPARTURE_CLOSED", "This departure has already left and can no longer be booked.");
  }
}
