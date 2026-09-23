import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { markSpaNoShow, spaAuthorityFor } from "@/lib/spa-lifecycle";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";

// Marks a CONFIRMED appointment as a no-show once the grace period has passed, applying the no-show fee policy.
// Rules live in src/lib/spa-lifecycle.ts (SPA_PLAN.md §6/§9), shared with the Booking API.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await markSpaNoShow(
      ctx,
      id,
      { waiveFee: body.waiveFee === true, notes: typeof body.notes === "string" ? body.notes : null },
      spaAuthorityFor(ctx)
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
