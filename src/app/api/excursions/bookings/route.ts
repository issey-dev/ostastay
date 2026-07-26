import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { resolveChargeTax } from "@/lib/tax-calc";
import { resolveBusinessDate } from "@/lib/business-date";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { rateForDate, computeBookingTotal, combineDepartureDateTime } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";

// Lists open walk-in excursion bills for a property — the retrieval path for the
// "pay later" half of the walk-in flow. Nothing else in the app has a browsable list of
// open walk-in folios today (POS only ever keeps one in local component state for the
// current session); ExcursionBooking's own folioId link makes this possible here
// without needing a general-purpose walk-in-folio list route.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "EXCURSIONS");

    // History mode: every booking (in-house + walk-in, any status), optionally filtered by
    // departure date — powers the Excursions History tab.
    if (searchParams.get("history") === "true") {
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      const history = await prisma.excursionBooking.findMany({
        where: {
          propertyId,
          ...(from && to ? { departure: { departureDate: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999Z`) } } } : {}),
        },
        include: {
          departure: { select: { departureDate: true, departureTime: true, excursionType: { select: { name: true } } } },
          folio: { select: { id: true, isClosed: true, taxInvoiceNumber: true } },
          reservation: { select: { primaryGuest: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: [{ departure: { departureDate: "desc" } }, { createdAt: "desc" }],
        take: 500,
      });
      return NextResponse.json(history);
    }

    const bookings = await prisma.excursionBooking.findMany({
      where: {
        propertyId,
        walkInGuestName: { not: null },
        status: "CONFIRMED",
        folio: { isClosed: false },
      },
      include: {
        departure: { select: { departureDate: true, departureTime: true } },
        folio: { select: { id: true, isClosed: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(bookings);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Books a departure for either an in-house guest (reservationId, billed to their
// existing open room folio) or a walk-in (folioId of an already-open walk-in folio —
// see POST /api/folios/walk-in, called first by the UI — identity is read off the
// folio itself rather than re-entered, so there's one source of truth for a walk-in's
// name/contact). Exactly one of the two must be provided. Billing always flows through
// the existing Folio/FolioLineItem machinery, same tax path as /api/pos/charge
// (resolveChargeTax, no Outlet involved).
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "create");

    const body = await request.json();
    const { departureId, reservationId, folioId } = body;
    // Optional "charge & pay now" for in-house bookings — post the charge to the room
    // folio AND settle it with a payment of the same amount (see the spa route for the
    // same pattern). Only honored for reservationId (in-house); walk-ins already have
    // their own pay panel.
    const settlementInput = body.settlement && typeof body.settlement === "object" && body.settlement.paymentMethodId
      ? { paymentMethodId: String(body.settlement.paymentMethodId), referenceNumber: body.settlement.referenceNumber ? String(body.settlement.referenceNumber) : null }
      : null;
    const adultCount = parseInt(body.adultCount) || 0;
    const childCount = parseInt(body.childCount) || 0;
    const infantCount = parseInt(body.infantCount) || 0;

    if (!departureId) {
      return NextResponse.json({ error: "departureId is required" }, { status: 400 });
    }
    if (!reservationId && !folioId) {
      return NextResponse.json({ error: "Either reservationId (in-house) or folioId (walk-in) is required" }, { status: 400 });
    }
    if (reservationId && folioId) {
      return NextResponse.json({ error: "Provide either reservationId or folioId, not both" }, { status: 400 });
    }
    if (adultCount + childCount + infantCount === 0) {
      return NextResponse.json({ error: "At least one guest is required" }, { status: 400 });
    }

    const departure = await prisma.excursionDeparture.findUnique({
      where: { id: departureId },
      include: {
        excursionType: {
          include: {
            rates: true,
            chargeCode: { include: { taxProfile: { include: { rates: true } } } },
            property: true,
          },
        },
      },
    });
    if (!departure) {
      return NextResponse.json({ error: "Departure not found" }, { status: 404 });
    }
    const { excursionType } = departure;
    await assertPropertyModuleAccess(ctx, excursionType.propertyId, "EXCURSIONS");

    if (departure.status !== "SCHEDULED") {
      return NextResponse.json({ error: "This departure is no longer taking bookings" }, { status: 400 });
    }

    // A departure that has already left can't be booked — nothing auto-transitions its
    // status after it sails, so the SCHEDULED check above isn't enough (the spa side has
    // the same guard). (A15)
    if (combineDepartureDateTime(departure.departureDate, departure.departureTime) < new Date()) {
      return NextResponse.json({ error: "This departure has already left and can no longer be booked." }, { status: 400 });
    }

    // Every booking must carry at least one guest — a 0-headcount booking would post a $0
    // charge and consume a manifest slot for nobody.
    const requested = adultCount + childCount + infantCount;
    if (requested <= 0) {
      return NextResponse.json({ error: "At least one guest is required to book." }, { status: 400 });
    }

    // Capacity enforcement: a departure's capacity is a hard boat/tour limit, not a soft
    // preference. Sum the CONFIRMED headcount already booked (same accounting the departures
    // list shows as bookedHeadcount) and reject if this booking would exceed capacity. (Best
    // effort against a concurrent burst under SQLite — the same TOCTOU caveat as every other
    // count-then-write guard here; the realistic path is a single operator clicking Book.)
    const booked = await prisma.excursionBooking.aggregate({
      where: { departureId, status: "CONFIRMED" },
      _sum: { adultCount: true, childCount: true, infantCount: true },
    });
    const bookedHeadcount = (booked._sum.adultCount ?? 0) + (booked._sum.childCount ?? 0) + (booked._sum.infantCount ?? 0);
    if (bookedHeadcount + requested > departure.capacity) {
      const remaining = Math.max(0, departure.capacity - bookedHeadcount);
      return NextResponse.json(
        { error: `This departure only has ${remaining} seat${remaining === 1 ? "" : "s"} left (capacity ${departure.capacity}).` },
        { status: 400 }
      );
    }

    let folioIdToCharge: string;
    let bookingIdentity: { reservationId: string | null; walkInGuestName: string | null; walkInGuestContact: string | null };
    let activityGuestLabel: string;

    if (reservationId) {
      // In-house guest: must be a reservation at THIS property with an open folio —
      // same shape /api/pos/search already surfaces (folioId of the first non-closed
      // folio).
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        include: { folios: { where: { isClosed: false } }, primaryGuest: true },
      });
      if (!reservation || reservation.propertyId !== excursionType.propertyId) {
        return NextResponse.json({ error: "Reservation not found at this property" }, { status: 404 });
      }
      // In-house bookings must fall WITHIN the guest's stay — the charge is realized on
      // their room folio, so it can't sit outside the dates they're actually here. An
      // out-of-stay departure should be booked as a walk-in instead.
      const dayMs = (d: Date | string) => { const x = new Date(d); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()); };
      const depMs = dayMs(departure.departureDate);
      if (depMs < dayMs(reservation.checkInDate) || depMs > dayMs(reservation.checkOutDate)) {
        return NextResponse.json(
          { error: "This departure is outside the guest's stay. Book within their stay dates, or use the walk-in option.", outsideStay: true },
          { status: 400 }
        );
      }
      const folio = reservation.folios[0];
      if (!folio) {
        return NextResponse.json({ error: "This guest has no open folio to bill the excursion to" }, { status: 400 });
      }
      folioIdToCharge = folio.id;
      bookingIdentity = { reservationId, walkInGuestName: null, walkInGuestContact: null };
      activityGuestLabel = `${reservation.primaryGuest.firstName} ${reservation.primaryGuest.lastName ?? ""}`.trim();
    } else {
      // Walk-in: folioId must already be an OPEN, reservation-less folio at this
      // property (opened via POST /api/folios/walk-in) — never a reservation's own
      // folio smuggled in through this param.
      const folio = await prisma.folio.findUnique({ where: { id: folioId } });
      if (!folio || folio.propertyId !== excursionType.propertyId) {
        return NextResponse.json({ error: "Folio not found at this property" }, { status: 404 });
      }
      if (folio.reservationId) {
        return NextResponse.json({ error: "This folio belongs to a reservation — use reservationId instead" }, { status: 400 });
      }
      if (folio.isClosed) {
        return NextResponse.json({ error: "This walk-in bill is already closed" }, { status: 400 });
      }
      folioIdToCharge = folio.id;
      bookingIdentity = { reservationId: null, walkInGuestName: folio.walkInGuestName, walkInGuestContact: folio.walkInGuestContact };
      activityGuestLabel = folio.walkInGuestName || "Walk-in guest";
    }

    let settlement: { paymentMethodId: string; referenceNumber: string | null } | null = null;
    if (settlementInput) {
      if (!reservationId) {
        return NextResponse.json({ error: "Pay-now settlement is only available for in-house guests." }, { status: 400 });
      }
      const method = await prisma.paymentMethod.findUnique({ where: { id: settlementInput.paymentMethodId } });
      if (!method || method.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
      }
      settlement = { paymentMethodId: method.id, referenceNumber: settlementInput.referenceNumber };
    }

    const rate = rateForDate(excursionType.rates, departure.departureDate);
    if (!rate) {
      return NextResponse.json({ error: "No price is configured for this departure's date" }, { status: 400 });
    }
    const totalAmount = computeBookingTotal(rate, excursionType.pricingMode, { adultCount, childCount, infantCount });

    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: excursionType.property.enterpriseId },
    });
    const { baseAmount, taxAmount, serviceChargeAmount } = resolveChargeTax({
      chargeCode: excursionType.chargeCode,
      inputAmount: totalAmount,
      settings,
      pricesIncludeTaxes: excursionType.property.pricesIncludeTaxes,
    });

    const headcountLabel = [
      adultCount ? `${adultCount} adult${adultCount === 1 ? "" : "s"}` : null,
      childCount ? `${childCount} child${childCount === 1 ? "" : "ren"}` : null,
      infantCount ? `${infantCount} infant${infantCount === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    // Single transaction: the FolioLineItem and the ExcursionBooking referencing it are
    // created together, so a booking never exists without its charge (or vice versa).
    // Same posting discipline as every other charge route: stamp the property's
    // business date (not wall clock) and attribute the posting to the caller's open
    // cashier drawer so it shows in their shift summary.
    const shift = await ensureOpenShift(ctx, excursionType.propertyId);

    const booking = await prisma.$transaction(async (tx) => {
      const lineItem = await tx.folioLineItem.create({
        data: {
          folioId: folioIdToCharge,
          chargeCodeId: excursionType.chargeCodeId,
          shiftId: shift.id,
          amount: baseAmount,
          taxAmount,
          serviceChargeAmount,
          description: `${excursionType.name} — ${headcountLabel} (${departure.departureDate.toISOString().slice(0, 10)} ${departure.departureTime})`,
          date: resolveBusinessDate(excursionType.property),
        },
      });

      // Charge & pay now: settle the just-posted charge with a payment of the same gross
      // (base + tax + service), so this booking's folio impact is zero.
      if (settlement) {
        await tx.payment.create({
          data: {
            folioId: folioIdToCharge,
            paymentMethodId: settlement.paymentMethodId,
            shiftId: shift.id,
            amount: baseAmount + taxAmount + serviceChargeAmount,
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
          folioLineItemId: lineItem.id,
          bookedByUserId: ctx.userId,
          notes: body.notes || null,
        },
        include: {
          departure: { include: { excursionType: true } },
          reservation: { include: { primaryGuest: true } },
        },
      });
    });

    await logActivity({
      ctx,
      module: "EXCURSIONS",
      action: "CREATE",
      entityType: "ExcursionBooking",
      entityId: booking.id,
      description: `Booked ${excursionType.name} for ${headcountLabel} — ${activityGuestLabel}`,
    });

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
