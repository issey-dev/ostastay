import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { completeSpaAppointment } from "@/lib/spa-lifecycle";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";

// Completes a treatment; under AT_COMPLETION charge timing this is where the charge posts.
// Rules live in src/lib/spa-lifecycle.ts (SPA_PLAN.md §6/§9), shared with the Booking API.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "create");
    const { id } = await params;
    const result = await completeSpaAppointment(ctx, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
