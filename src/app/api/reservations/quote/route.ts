import { NextResponse } from "next/server";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { computeReservationQuote } from "@/lib/reservation-quote-server";

// Dry-run pricing for the booking form's summary panel — never writes anything.
// Accepts the exact in-progress form shape (assignments still being edited, possibly
// with a pending room/rate not yet saved) and returns the full projected stay cost
// with a per-charge-code tax breakdown. See src/lib/reservation-quote-server.ts for
// why this can never disagree with what Night Audit actually posts.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json();

    if (!body.propertyId || !Array.isArray(body.assignments) || body.assignments.length === 0) {
      return NextResponse.json({ error: "propertyId and at least one assignment are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    const assignments = body.assignments.map((a: { roomTypeId: string; ratePlanId: string; startDate: string; endDate: string; overrideRate?: number | string | null }) => ({
      roomTypeId: a.roomTypeId,
      ratePlanId: a.ratePlanId,
      startDate: new Date(a.startDate),
      endDate: new Date(a.endDate),
      overrideRate: a.overrideRate === "" || a.overrideRate == null ? null : Number(a.overrideRate),
    }));

    if (assignments.some((a: { roomTypeId: string; ratePlanId: string; startDate: Date; endDate: Date }) =>
      !a.roomTypeId || !a.ratePlanId || isNaN(a.startDate.getTime()) || isNaN(a.endDate.getTime()) || a.endDate <= a.startDate
    )) {
      return NextResponse.json({ error: "Every segment needs a room type, rate plan, and a valid date range" }, { status: 400 });
    }

    const quote = await computeReservationQuote({
      propertyId: body.propertyId,
      assignments,
      adults: Math.max(1, parseInt(body.adults) || 1),
      children: Math.max(0, parseInt(body.children) || 0),
      mealPlanCode: body.mealPlanCode ?? null,
      manualAllocationIds: Array.isArray(body.manualAllocationIds) ? body.manualAllocationIds : [],
    });

    return NextResponse.json(quote);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
