import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";

// Manifest data source for one departure — every non-cancelled booking (CONFIRMED,
// COMPLETED, NO_SHOW all stay visible; only CANCELLED is filtered, since a cancelled
// booking no longer needs a crew's attention) with enough guest detail to brief a boat
// crew: name, room if in-house, headcount, notes.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "EXCURSIONS", "view");

    const { id } = await params;
    const departure = await prisma.excursionDeparture.findUnique({
      where: { id },
      include: {
        excursionType: { select: { id: true, code: true, name: true, propertyId: true } },
        bookings: {
          where: { status: { not: "CANCELLED" } },
          include: {
            reservation: {
              include: {
                primaryGuest: { select: { firstName: true, lastName: true } },
                assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { select: { roomNumber: true } } } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!departure) {
      return NextResponse.json({ error: "Departure not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, departure.excursionType.propertyId, "EXCURSIONS");

    const bookings = departure.bookings.map((b) => ({
      id: b.id,
      guestName: b.reservation
        ? `${b.reservation.primaryGuest.firstName} ${b.reservation.primaryGuest.lastName ?? ""}`.trim()
        : b.walkInGuestName ?? "Walk-in",
      roomNumber: b.reservation?.assignments[0]?.room?.roomNumber ?? null,
      isWalkIn: !b.reservationId,
      adultCount: b.adultCount,
      childCount: b.childCount,
      infantCount: b.infantCount,
      totalAmount: b.totalAmount,
      status: b.status,
      notes: b.notes,
      folioId: b.folioId,
      folioLineItemId: b.folioLineItemId,
      createdAt: b.createdAt,
    }));

    return NextResponse.json({
      id: departure.id,
      excursionType: departure.excursionType,
      departureDate: departure.departureDate,
      departureTime: departure.departureTime,
      meetingTime: departure.meetingTime,
      meetingPoint: departure.meetingPoint,
      capacity: departure.capacity,
      minCapacity: departure.minCapacity,
      status: departure.status,
      bookings,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
