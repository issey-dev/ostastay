import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate } from "@/lib/business-date";
import { computeReservationQuote } from "@/lib/reservation-quote-server";

const DAY_MS = 86_400_000;

// Rate preview for the Move Room dialog: given a candidate new room type, returns the
// guest's current nightly rate ("keep") vs. the new room type's nightly rate ("new"),
// priced through the SAME resolver Night Audit posts with — so the figures staff see
// match what actually bills. Read-only.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "view");

    const { id } = await params;
    const newRoomTypeId = new URL(request.url).searchParams.get("newRoomTypeId");
    if (!newRoomTypeId) return NextResponse.json({ error: "newRoomTypeId is required" }, { status: 400 });

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { assignments: { orderBy: { startDate: "desc" } } },
    });
    if (!reservation) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    await assertPropertyAccess(ctx, reservation.propertyId);

    const active = reservation.assignments[0];
    if (!active) return NextResponse.json({ error: "No active room assignment" }, { status: 400 });

    const property = await prisma.property.findUnique({ where: { id: reservation.propertyId } });
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });

    const businessDate = resolveBusinessDate(property);
    const nextNight = new Date(businessDate.getTime() + DAY_MS);
    const sameType = newRoomTypeId === active.roomTypeId;

    // Price ONE representative night (the move date) under a given basis.
    const nightlyRate = async (roomTypeId: string, chargeRoomTypeId: string | null, overrideRate: number | null) => {
      const quote = await computeReservationQuote({
        propertyId: reservation.propertyId,
        assignments: [{ roomTypeId, chargeRoomTypeId, ratePlanId: active.ratePlanId, startDate: businessDate, endDate: nextNight, overrideRate }],
        adults: reservation.adults,
        children: reservation.children,
        // Meal plan / allocations don't affect the room nightRate — omitted deliberately.
      });
      return quote.days[0]?.rate ?? 0;
    };

    // "Keep" = what they pay now (their current physical type, any charge-as type, any override).
    const keepRate = await nightlyRate(active.roomTypeId, active.chargeRoomTypeId ?? null, active.overrideRate ?? null);
    // "New" = the new room type's own calendar rate, no override.
    const newRate = sameType ? keepRate : await nightlyRate(newRoomTypeId, null, null);

    const remainingNights = Math.max(1, Math.round((reservation.checkOutDate.getTime() - businessDate.getTime()) / DAY_MS));

    return NextResponse.json({ sameType, keepRate, newRate, remainingNights });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
