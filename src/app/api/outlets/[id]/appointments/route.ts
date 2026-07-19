import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1 hour, used only for overlap computation
// when no endTime is given — the stored row keeps endTime null either way.

function effectiveEnd(startTime: Date, endTime: Date | null): Date {
  return endTime ?? new Date(startTime.getTime() + DEFAULT_DURATION_MS);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    const { id: outletId } = await params;
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) {
      return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, outlet.propertyId);

    const appointments = await prisma.outletAppointment.findMany({
      where: {
        outletId,
        ...(from || to
          ? {
              startTime: {
                ...(from && { gte: new Date(from) }),
                ...(to && { lte: new Date(to) }),
              },
            }
          : {}),
      },
      include: {
        chargeCode: true,
        reservation: { include: { primaryGuest: true } },
      },
      orderBy: { startTime: "asc" },
    });

    return NextResponse.json(appointments);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// A simple appointment log (no resource/room-capacity model) — an optional
// appointmentCapPerSlot on the Outlet only ever produces a non-blocking `capWarning`
// in the response; it never rejects the booking. Full resource-capacity booking is
// explicitly out of scope for this tier.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "POS", "create");

    const { id: outletId } = await params;
    const body = await request.json();
    const { chargeCodeId, startTime, endTime, reservationId, walkInGuestName, walkInGuestContact, notes } = body;

    if (!startTime) {
      return NextResponse.json({ error: "startTime is required" }, { status: 400 });
    }
    if (!!reservationId === !!walkInGuestName) {
      return NextResponse.json({ error: "Provide exactly one of reservationId or walkInGuestName" }, { status: 400 });
    }

    const outlet = await prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) {
      return NextResponse.json({ error: "Outlet not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, outlet.propertyId);

    if (reservationId) {
      const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
      if (!reservation || reservation.propertyId !== outlet.propertyId) {
        return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
      }
    }

    if (chargeCodeId) {
      const isInOutletPool = await prisma.outletChargeCode.findUnique({
        where: { outletId_chargeCodeId: { outletId, chargeCodeId } }
      });
      if (!isInOutletPool) {
        return NextResponse.json({ error: "This charge code is not offered by the selected outlet" }, { status: 400 });
      }
    }

    const newStart = new Date(startTime);
    const newEnd = endTime ? new Date(endTime) : null;
    const newEffectiveEnd = effectiveEnd(newStart, newEnd);

    const appointment = await prisma.outletAppointment.create({
      data: {
        outletId,
        chargeCodeId: chargeCodeId || null,
        startTime: newStart,
        endTime: newEnd,
        reservationId: reservationId || null,
        walkInGuestName: walkInGuestName || null,
        walkInGuestContact: walkInGuestContact || null,
        notes: notes || null,
        createdByUserId: ctx.userId,
      },
      include: {
        chargeCode: true,
        reservation: { include: { primaryGuest: true } },
      },
    });

    let capWarning: { cap: number; overlappingCount: number } | undefined;
    if (outlet.appointmentCapPerSlot !== null) {
      const existing = await prisma.outletAppointment.findMany({
        where: { outletId, status: { not: "CANCELLED" }, id: { not: appointment.id } },
        select: { startTime: true, endTime: true },
      });
      const overlappingCount = existing.filter((a) => {
        const aEnd = effectiveEnd(a.startTime, a.endTime);
        return a.startTime < newEffectiveEnd && newStart < aEnd;
      }).length + 1; // +1 for the appointment just created

      if (overlappingCount > outlet.appointmentCapPerSlot) {
        capWarning = { cap: outlet.appointmentCapPerSlot, overlappingCount };
      }
    }

    return NextResponse.json({ appointment, capWarning }, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
