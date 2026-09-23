import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { createExcursionBooking } from "@/lib/excursion-booking";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";

// Lists open walk-in excursion bills for a property — the retrieval path for the
// "pay later" half of the walk-in flow. Nothing else in the app has a browsable list of
// open walk-in folios today (POS only ever keeps one in local component state for the
// current session); ExcursionBooking's own folioId link makes this possible here
// without needing a general-purpose walk-in-folio list route.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "EXCURSIONS");

    // History mode: every booking (in-house + walk-in, any status), optionally filtered by
    // departure date — powers the Excursions History tab.
    if (searchParams.get("history") === "true") {
      const from = searchParams.get("from");
      const to = searchParams.get("to");
      const history = await prisma.excursionBooking.findMany({
        where: {
          propertyId,
          ...(from && to ? { departure: { departureDate: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999Z`) } } } : {}),
        },
        include: {
          departure: { select: { departureDate: true, departureTime: true, excursionType: { select: { name: true } } } },
          folio: { select: { id: true, isClosed: true, taxInvoiceNumber: true } },
          reservation: { select: { primaryGuest: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: [{ departure: { departureDate: "desc" } }, { createdAt: "desc" }],
        take: 500,
      });
      return NextResponse.json(history);
    }

    const bookings = await prisma.excursionBooking.findMany({
      where: {
        propertyId,
        walkInGuestName: { not: null },
        status: "CONFIRMED",
        folio: { isClosed: false },
      },
      include: {
        departure: { select: { departureDate: true, departureTime: true } },
        folio: { select: { id: true, isClosed: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(bookings);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Books a departure for an in-house guest (reservationId, billed to their open room
// folio) or a walk-in (folioId of an already-open walk-in folio — POST
// /api/folios/walk-in, called first by the UI). Exactly one of the two. All the rules
// live in createExcursionBooking (src/lib/excursion-booking.ts), shared with the public
// Booking API; this route only parses the request and maps refusals onto its response.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "create");

    const body = await request.json();
    const { departureId, reservationId, folioId } = body;
    if (!departureId) {
      return NextResponse.json({ error: "departureId is required" }, { status: 400 });
    }
    if (!reservationId && !folioId) {
      return NextResponse.json({ error: "Either reservationId (in-house) or folioId (walk-in) is required" }, { status: 400 });
    }
    if (reservationId && folioId) {
      return NextResponse.json({ error: "Provide either reservationId or folioId, not both" }, { status: 400 });
    }

    const booking = await createExcursionBooking(ctx, {
      departureId,
      guest: reservationId ? { kind: "RESERVATION", reservationId } : { kind: "WALK_IN_FOLIO", folioId },
      adultCount: parseInt(body.adultCount) || 0,
      childCount: parseInt(body.childCount) || 0,
      infantCount: parseInt(body.infantCount) || 0,
      notes: body.notes || null,
      settlement:
        body.settlement && typeof body.settlement === "object" && body.settlement.paymentMethodId
          ? {
              paymentMethodId: String(body.settlement.paymentMethodId),
              referenceNumber: body.settlement.referenceNumber ? String(body.settlement.referenceNumber) : null,
            }
          : null,
    });

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
