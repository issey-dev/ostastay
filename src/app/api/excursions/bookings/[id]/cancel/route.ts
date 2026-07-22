import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { combineDepartureDateTime } from "@/lib/excursions";
import { logActivity } from "@/lib/activity-log";

// Cancels a CONFIRMED booking. Two independent gates, not one:
//  - Cutoff window (ExcursionType.cutoffHours before departure): within it, any actor
//    with EXCURSIONS update can cancel freely; past it, cancelling requires the higher
//    EXCURSIONS delete action (manager override) — same override-by-higher-permission
//    pattern used elsewhere in this app.
//  - Voiding the posted charge, if any, requires CASHIERING update — the SAME gate
//    /api/folios/[id]/line-items/[id]/void itself uses, since this performs the
//    identical action. A front-desk actor without cashiering access can still cancel
//    the booking (frees the seat, updates the manifest) but the charge is left in
//    place with chargeVoided:false in the response, for cashiering staff to void
//    separately — cancelling a seat and touching money are different trust levels.
//  - A charge on an already-CLOSED folio can never be voided (folios are immutable
//    once closed, see the void route's own comment) — cancelling still succeeds, but
//    any refund has to happen outside the system (e.g. a manual cash refund), same as
//    every other "closed folio" correction in this app.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "update");

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "A reason is required to cancel a booking" }, { status: 400 });
    }

    const booking = await prisma.excursionBooking.findUnique({
      where: { id },
      include: {
        departure: { include: { excursionType: true } },
        folioLineItem: true,
      },
    });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, booking.propertyId, "EXCURSIONS");

    if (booking.status !== "CONFIRMED") {
      return NextResponse.json({ error: `Cannot cancel a booking with status ${booking.status}` }, { status: 400 });
    }

    const departureAt = combineDepartureDateTime(booking.departure.departureDate, booking.departure.departureTime);
    const cutoffAt = new Date(departureAt.getTime() - booking.departure.excursionType.cutoffHours * 60 * 60 * 1000);
    const isPastCutoff = new Date() > cutoffAt;
    if (isPastCutoff) {
      try {
        requirePermission(ctx, "EXCURSIONS", "delete");
      } catch (e) {
        if (e instanceof ForbiddenError) {
          return NextResponse.json(
            { error: `Past the ${booking.departure.excursionType.cutoffHours}-hour cancellation cutoff — a manager override is required` },
            { status: 403 }
          );
        }
        throw e;
      }
    }

    const folio = booking.folioLineItemId ? await prisma.folio.findUnique({ where: { id: booking.folioId } }) : null;
    const canVoid = !!booking.folioLineItem && !booking.folioLineItem.isVoid && folio && !folio.isClosed;
    let hasCashieringAccess = false;
    if (canVoid) {
      try {
        requirePermission(ctx, "CASHIERING", "update");
        hasCashieringAccess = true;
      } catch (e) {
        if (!(e instanceof ForbiddenError)) throw e;
      }
    }
    const willVoid = canVoid && hasCashieringAccess;

    await prisma.$transaction(async (tx) => {
      if (willVoid && booking.folioLineItemId) {
        await tx.folioLineItem.update({ where: { id: booking.folioLineItemId }, data: { isVoid: true } });
      }
      await tx.excursionBooking.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason },
      });
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

    return NextResponse.json({ success: true, chargeVoided: willVoid, chargeNote });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
