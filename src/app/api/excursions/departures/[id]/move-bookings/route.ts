import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { postCharge, chargeCodeInclude } from "@/lib/posting/post-charge";
import { resolveBusinessDate } from "@/lib/business-date";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { rateForDate, computeBookingTotal } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";

// Moves a batch of already-cancelled bookings (from a departure cancelled via
// .../departures/[id]/cancel) onto a replacement departure of the SAME excursion type.
// Each move creates a brand-new ExcursionBooking (with movedFromDepartureId pointing at
// the original departure) and a fresh FolioLineItem priced for the new date — it never
// mutates the cancelled booking, so the manifest history stays honest about what
// actually happened. Re-derives "is this booking actually movable" itself rather than
// trusting the client's list, since a booking whose charge was never voided (closed
// folio, or the actor lacked cashiering access at cancel time) would be double-charged
// if moved.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "create");

    const { id: sourceDepartureId } = await params;
    const body = await request.json();
    const targetDepartureId = body.targetDepartureId;
    const bookingIds: string[] = Array.isArray(body.bookingIds) ? body.bookingIds : [];
    if (!targetDepartureId || bookingIds.length === 0) {
      return NextResponse.json({ error: "targetDepartureId and at least one bookingId are required" }, { status: 400 });
    }

    const targetDeparture = await prisma.excursionDeparture.findUnique({
      where: { id: targetDepartureId },
      include: {
        excursionType: {
          include: { rates: true, chargeCode: { include: { taxProfile: { include: { rates: true } } } }, property: true },
        },
      },
    });
    if (!targetDeparture) {
      return NextResponse.json({ error: "Replacement departure not found" }, { status: 404 });
    }
    const { excursionType } = targetDeparture;
    await assertPropertyModuleAccess(ctx, excursionType.propertyId, "EXCURSIONS");

    if (targetDeparture.status !== "SCHEDULED") {
      return NextResponse.json({ error: "The replacement departure is no longer taking bookings" }, { status: 400 });
    }

    const rate = rateForDate(excursionType.rates, targetDeparture.departureDate);
    if (!rate) {
      return NextResponse.json({ error: "No price is configured for the replacement departure's date" }, { status: 400 });
    }
    const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId: excursionType.property.enterpriseId } });
    // Re-posted charges follow the same discipline as every other charge route:
    // business-date stamped and attributed to the caller's open cashier drawer.
    const shift = await ensureOpenShift(ctx, excursionType.propertyId);

    const moved: Array<{ bookingId: string; newBookingId: string }> = [];
    const failed: Array<{ bookingId: string; reason: string }> = [];

    // Target capacity: seed with what's already CONFIRMED on the replacement departure,
    // then account for each move as it lands so a batch can't overfill it (the cancel
    // route only SUGGESTS a replacement with room; this is the endpoint that must enforce it).
    const targetBooked = await prisma.excursionBooking.aggregate({
      where: { departureId: targetDepartureId, status: "CONFIRMED" },
      _sum: { adultCount: true, childCount: true, infantCount: true },
    });
    let targetHeadcount = (targetBooked._sum.adultCount ?? 0) + (targetBooked._sum.childCount ?? 0) + (targetBooked._sum.infantCount ?? 0);

    for (const bookingId of bookingIds) {
      const original = await prisma.excursionBooking.findUnique({
        where: { id: bookingId },
        include: { folioLineItem: true, reservation: { include: { folios: { where: { isClosed: false } } } } },
      });

      // Tenant/property isolation: only the TARGET departure is authorized above
      // (assertPropertyModuleAccess). The source departure id and each bookingId come
      // straight from the request, so we must confirm the booking actually belongs to the
      // same property as the authorized target — otherwise a caller could move (and post a
      // charge onto) a booking in another enterprise. Same generic "not found" message so
      // it can't be used to probe foreign booking ids.
      if (!original || original.departureId !== sourceDepartureId || original.propertyId !== excursionType.propertyId) {
        failed.push({ bookingId, reason: "Booking not found on the source departure" });
        continue;
      }
      if (original.status !== "CANCELLED") {
        failed.push({ bookingId, reason: "Booking is not cancelled" });
        continue;
      }
      if (original.movedToBookingId) {
        failed.push({ bookingId, reason: "This booking has already been moved to a replacement departure" });
        continue;
      }
      // Movable = no charge was ever posted, or the charge was successfully voided —
      // re-derived here rather than trusted from the request.
      if (original.folioLineItemId && !original.folioLineItem?.isVoid) {
        failed.push({ bookingId, reason: "This booking's charge was never voided — moving it would double-charge the guest" });
        continue;
      }

      let folioIdToCharge: string;
      if (original.reservationId) {
        const openFolio = original.reservation?.folios[0];
        if (!openFolio) {
          failed.push({ bookingId, reason: "The guest's reservation no longer has an open folio" });
          continue;
        }
        folioIdToCharge = openFolio.id;
      } else {
        const folio = await prisma.folio.findUnique({ where: { id: original.folioId } });
        if (!folio || folio.isClosed) {
          failed.push({ bookingId, reason: "The walk-in bill is no longer open" });
          continue;
        }
        folioIdToCharge = folio.id;
      }

      const moveHeadcount = original.adultCount + original.childCount + original.infantCount;
      if (targetHeadcount + moveHeadcount > targetDeparture.capacity) {
        failed.push({ bookingId, reason: `The replacement departure is full (capacity ${targetDeparture.capacity}).` });
        continue;
      }

      const totalAmount = computeBookingTotal(rate, excursionType.pricingMode, {
        adultCount: original.adultCount,
        childCount: original.childCount,
        infantCount: original.infantCount,
      });

      const headcountLabel = [
        original.adultCount ? `${original.adultCount} adult${original.adultCount === 1 ? "" : "s"}` : null,
        original.childCount ? `${original.childCount} child${original.childCount === 1 ? "" : "ren"}` : null,
        original.infantCount ? `${original.infantCount} infant${original.infantCount === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      const newBooking = await prisma.$transaction(async (tx) => {
        // Re-posted through the one posting service, so a moved booking is taxed and
        // generates exactly like the original booking was.
        const postableCode = await tx.chargeCode.findUniqueOrThrow({
          where: { id: excursionType.chargeCodeId },
          include: chargeCodeInclude(),
        });
        const posted = await postCharge(tx, {
          folioId: folioIdToCharge,
          chargeCode: postableCode,
          inputAmount: totalAmount,
          settings,
          pricesIncludeTaxes: excursionType.property.pricesIncludeTaxes,
          date: resolveBusinessDate(excursionType.property),
          description: `${excursionType.name} — ${headcountLabel} (${targetDeparture.departureDate.toISOString().slice(0, 10)} ${targetDeparture.departureTime}) — moved from cancelled departure`,
          shiftId: shift.id,
          postingContext: { adults: original.adultCount, children: original.childCount, nights: 1 },
        });
        const lineItem = posted.parent;
        const created = await tx.excursionBooking.create({
          data: {
            departureId: targetDepartureId,
            propertyId: excursionType.propertyId,
            reservationId: original.reservationId,
            walkInGuestName: original.walkInGuestName,
            walkInGuestContact: original.walkInGuestContact,
            adultCount: original.adultCount,
            childCount: original.childCount,
            infantCount: original.infantCount,
            totalAmount,
            folioId: folioIdToCharge,
            folioLineItemId: lineItem.id,
            bookedByUserId: ctx.userId,
            notes: original.notes,
            movedFromDepartureId: sourceDepartureId,
          },
        });
        // Marks the OLD booking as spent so it can never be moved again (see the
        // movedToBookingId check above) — done in the same transaction as creating
        // its replacement so the two never diverge.
        await tx.excursionBooking.update({ where: { id: original.id }, data: { movedToBookingId: created.id } });
        return created;
      });

      moved.push({ bookingId, newBookingId: newBooking.id });
      targetHeadcount += moveHeadcount;
    }

    await logActivity({
      ctx,
      module: "EXCURSIONS",
      action: "CREATE",
      entityType: "ExcursionBooking",
      description: `Moved ${moved.length} booking(s) from a cancelled departure to "${excursionType.name}" (${targetDeparture.departureDate.toISOString().slice(0, 10)} ${targetDeparture.departureTime})${failed.length ? `, ${failed.length} failed` : ""}`,
    });

    return NextResponse.json({ success: true, moved, failed });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
