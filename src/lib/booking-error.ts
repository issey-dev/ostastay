import { NextResponse } from "next/server";

// A business-rule refusal from a booking/lifecycle service (src/lib/excursion-booking.ts,
// src/lib/spa-booking.ts, src/lib/spa-lifecycle.ts). The services are shared by the
// session routes the desk uses and, from Phase 2 of BOOKING_API_ADDONS_PLAN.md, the
// public Booking API — so they cannot build a NextResponse themselves: each caller maps
// the error onto its own response shape. `code` is the stable machine code the public
// API will expose; `extra` carries fields the desk UI already reads (e.g. outsideStay).
export class BookingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BookingError";
  }
}

/** The session routes' existing error shape: `{ error, ...extra }`. */
export function bookingErrorResponse(error: BookingError): NextResponse {
  return NextResponse.json({ error: error.message, code: error.code, ...(error.extra ?? {}) }, { status: error.status });
}
