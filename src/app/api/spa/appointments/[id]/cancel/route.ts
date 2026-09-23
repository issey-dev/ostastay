import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { cancelSpaAppointment, spaAuthorityFor } from "@/lib/spa-lifecycle";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";

// Cancels an appointment: voids its charge, or applies the late-cancellation fee past the cutoff.
// Rules live in src/lib/spa-lifecycle.ts (SPA_PLAN.md §6/§9), shared with the Booking API.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await cancelSpaAppointment(
      ctx,
      id,
      {
        reasonCode: typeof body.reasonCode === "string" ? body.reasonCode : "",
        notes: typeof body.notes === "string" ? body.notes : null,
        waiveFee: body.waiveFee === true,
      },
      // Past the cutoff or mid-treatment needs SPA delete; voiding the charge needs
      // CASHIERING update — checked independently, as in Excursions cancel.
      spaAuthorityFor(ctx)
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
