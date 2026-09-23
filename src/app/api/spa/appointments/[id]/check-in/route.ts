import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { checkInSpaAppointment } from "@/lib/spa-lifecycle";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";

// Marks a CONFIRMED appointment's guest as arrived at the spa (on the day only).
// Rules live in src/lib/spa-lifecycle.ts (SPA_PLAN.md §6/§9), shared with the Booking API.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "create");
    const { id } = await params;
    const result = await checkInSpaAppointment(ctx, id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
