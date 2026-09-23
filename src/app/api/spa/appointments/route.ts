import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { dayStart } from "@/lib/spa-availability";
import { createSpaAppointment, expireStaleSpaHolds, spaAppointmentInclude as includeShape, type SpaParticipantInput } from "@/lib/spa-booking";
import { BookingError, bookingErrorResponse } from "@/lib/booking-error";

// Lists a property's appointments for one date — the booking page's "today's
// schedule" list. The full tape-chart grid is Phase 4; this is a plain list for now.
// With `openWalkIns=true` instead of `date`: every still-open walk-in-billed
// appointment regardless of date — the "pay later" retrieval path, same reasoning as
// GET /api/excursions/bookings (nothing else in the app has a browsable list of open
// walk-in folios; SpaAppointment.folioId makes this possible here too).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");
    // Online holds past their time show as cancelled (HOLD_EXPIRED), not tentative forever.
    await expireStaleSpaHolds(propertyId);

    if (searchParams.get("openWalkIns") === "true") {
      const appointments = await prisma.spaAppointment.findMany({
        where: {
          propertyId,
          appointmentStatus: { notIn: ["CANCELLED"] },
          folio: { isClosed: false },
          participants: { some: { participantIndex: 1, walkInGuestName: { not: null } } },
        },
        include: includeShape,
        orderBy: [{ createdAt: "desc" }],
      });
      return NextResponse.json(appointments);
    }

    // Date-range mode (from/to), optionally filtered to one therapist — powers the Spa
    // Schedule calendar. A therapist matches an appointment if any participant is assigned
    // to them.
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from && to) {
      const therapistId = searchParams.get("therapistId");
      const rangeAppointments = await prisma.spaAppointment.findMany({
        where: {
          propertyId,
          appointmentDate: { gte: dayStart(new Date(from)), lte: dayStart(new Date(to)) },
          ...(therapistId ? { participants: { some: { therapistId } } } : {}),
        },
        include: includeShape,
        orderBy: [{ appointmentDate: "asc" }, { startTime: "asc" }],
      });
      return NextResponse.json(rangeAppointments);
    }

    const dateParam = searchParams.get("date");
    if (!dateParam) {
      return NextResponse.json({ error: "date, from/to range, or openWalkIns=true is required" }, { status: 400 });
    }
    const date = new Date(dateParam);
    if (isNaN(date.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }

    const appointments = await prisma.spaAppointment.findMany({
      where: { propertyId, appointmentDate: dayStart(date) },
      include: includeShape,
      orderBy: [{ startTime: "asc" }],
    });
    return NextResponse.json(appointments);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Books a treatment for one or more guests sharing one room and one time window. All
// the rules live in createSpaAppointment (src/lib/spa-booking.ts), shared with the public
// Booking API; this route only parses the request and maps refusals onto its response.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "SPA", "create");

    const body = await request.json();
    const appointment = await createSpaAppointment(ctx, {
      propertyId: body.propertyId,
      treatmentId: body.treatmentId,
      appointmentDate: body.appointmentDate,
      startTime: body.startTime,
      roomId: body.roomId || null,
      notes: body.notes || null,
      participants: Array.isArray(body.participants) ? (body.participants as SpaParticipantInput[]) : [],
      settlement:
        body.settlement && typeof body.settlement === "object" && body.settlement.paymentMethodId
          ? {
              paymentMethodId: String(body.settlement.paymentMethodId),
              referenceNumber: body.settlement.referenceNumber ? String(body.settlement.referenceNumber) : null,
            }
          : null,
    });

    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    if (error instanceof BookingError) return bookingErrorResponse(error);
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
