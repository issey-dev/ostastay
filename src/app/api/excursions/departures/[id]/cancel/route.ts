import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { combineDepartureDateTime } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";
import { lockKeys, lockKey, BOOKING_TX_OPTIONS } from "@/lib/db-lock";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";
import { voidPostedCharge, actorDisplayName } from "@/lib/posting/void-charge";

// Cancels an ENTIRE departure (e.g. weather) — cascades to every CONFIRMED booking on
// it. Manager-only (EXCURSIONS delete) regardless of the cutoff window: this is an
// operator decision affecting other people's bookings without their consent, not the
// per-guest cutoff-window cancellation POST .../bookings/[id]/cancel covers.
//
// Same CASHIERING-gated voiding as a single-booking cancel, but the check happens ONCE
// for the whole batch (same actor, same authorization) rather than per booking. A
// booking is only "movable" to a replacement departure (see .../move-bookings) if its
// charge was actually voided — one still holding an unvoided charge (closed folio, or
// the actor lacks cashiering access) is left as-is and flagged for manual handling,
// since moving it would double-charge the guest for the same trip.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "delete");

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "A reason is required to cancel a departure" }, { status: 400 });
    }

    const departure = await prisma.excursionDeparture.findUnique({
      where: { id },
      include: { excursionType: true },
    });
    if (!departure) {
      return NextResponse.json({ error: "Departure not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, departure.excursionType.propertyId, "EXCURSIONS");

    if (departure.status !== "SCHEDULED") {
      return NextResponse.json({ error: `Cannot cancel a departure with status ${departure.status}` }, { status: 400 });
    }

    let hasCashieringAccess = false;
    try {
      requirePermission(ctx, "CASHIERING", "update");
      hasCashieringAccess = true;
    } catch (e) {
      if (!(e instanceof ForbiddenError)) throw e;
    }

    let voidedCount = 0;
    let cancelledCount = 0;
    const movableBookingIds: string[] = [];
    const unmovable: Array<{ bookingId: string; reason: string }> = [];

    await prisma.$transaction(async (tx) => {
      // Take the departure lock every booking takes (src/lib/db-lock.ts) and read the
      // bookings UNDER it, so a desk or Booking API booking can't land between reading
      // the manifest and flipping the departure to CANCELLED.
      await lockKeys(tx, [lockKey.excursionDeparture(id)]);
      const current = await tx.excursionDeparture.findUniqueOrThrow({ where: { id } });
      if (current.status !== "SCHEDULED") {
        throw new BookingError(400, "DEPARTURE_CLOSED", `Cannot cancel a departure with status ${current.status}`);
      }
      const bookings = await tx.excursionBooking.findMany({
        where: { departureId: id, status: "CONFIRMED" },
        include: { folioLineItem: true },
      });
      const folioIds = [...new Set(bookings.map((b) => b.folioId))];
      const folios = await tx.folio.findMany({ where: { id: { in: folioIds } }, select: { id: true, isClosed: true } });
      const closedFolioIds = new Set(folios.filter((f) => f.isClosed).map((f) => f.id));

      cancelledCount = bookings.length;
      const actorName = await actorDisplayName(tx, ctx.userId);
      for (const booking of bookings) {
        const canVoid = !!booking.folioLineItem && !booking.folioLineItem.isVoid && !closedFolioIds.has(booking.folioId);
        const willVoid = canVoid && hasCashieringAccess;

        if (willVoid && booking.folioLineItemId) {
          await voidPostedCharge(tx, { lineItemId: booking.folioLineItemId, reason: `Departure cancelled: ${reason}`, actorName });
          voidedCount++;
        }

        await tx.excursionBooking.update({
          where: { id: booking.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: `Departure cancelled: ${reason}` },
        });

        if (!booking.folioLineItemId || willVoid) {
          movableBookingIds.push(booking.id);
        } else {
          unmovable.push({
            bookingId: booking.id,
            reason: closedFolioIds.has(booking.folioId)
              ? "Bill already closed — refund must be handled manually"
              : "Charge left in place — cashiering access is required to void it",
          });
        }
      }

      await tx.excursionDeparture.update({ where: { id }, data: { status: "CANCELLED" } });
    }, BOOKING_TX_OPTIONS);

    // Auto-suggest the next scheduled departure of the same excursion type with room
    // left — the UI offers a one-click "move these guests here" on top of this.
    const candidates = await prisma.excursionDeparture.findMany({
      where: {
        excursionTypeId: departure.excursionTypeId,
        status: "SCHEDULED",
        id: { not: id },
        departureDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      include: { bookings: { where: { status: "CONFIRMED" }, select: { adultCount: true, childCount: true, infantCount: true } } },
      orderBy: [{ departureDate: "asc" }, { departureTime: "asc" }],
      take: 10,
    });
    const now = new Date();
    const replacement = candidates.find((c) => {
      // The DB query above only filters by date (a coarse pre-filter to keep the
      // candidate set small) — a same-day departure whose time has already passed
      // (e.g. cancelling this morning's trip after its own 9am replacement already
      // left) must still be excluded here by the real combined date+time.
      if (combineDepartureDateTime(c.departureDate, c.departureTime) <= now) return false;
      const booked = c.bookings.reduce((s, b) => s + b.adultCount + b.childCount + b.infantCount, 0);
      return booked < c.capacity;
    });

    await logActivity({
      ctx,
      module: "EXCURSIONS",
      action: "UPDATE",
      entityType: "ExcursionDeparture",
      entityId: id,
      description: `Cancelled departure for "${departure.excursionType.name}" (${cancelledCount} booking(s), ${voidedCount} voided) — ${reason}`,
    });

    return NextResponse.json({
      success: true,
      cancelledCount,
      voidedCount,
      movableBookingIds,
      unmovable,
      suggestedReplacement: replacement
        ? { id: replacement.id, departureDate: replacement.departureDate, departureTime: replacement.departureTime, capacity: replacement.capacity }
        : null,
    });
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
