import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { cancelExcursionBooking, excursionAuthorityFor } from "@/lib/excursion-booking";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";

// Cancels a CONFIRMED booking from the desk. The rules — the cutoff and its manager
// override (EXCURSIONS delete), voiding the charge only with CASHIERING update and an open
// folio — live in cancelExcursionBooking (src/lib/excursion-booking.ts), shared with the
// Booking API's guest self-cancel.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "update");

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await cancelExcursionBooking(
      ctx,
      id,
      { reason: typeof body.reason === "string" ? body.reason : "" },
      excursionAuthorityFor(ctx)
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
