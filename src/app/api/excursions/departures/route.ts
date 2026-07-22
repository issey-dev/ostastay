import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";

// Lists upcoming, bookable departures for a property — the data source for the
// Excursions booking screen's departure picker. Capacity/minCapacity counts are
// computed LIVE from non-cancelled bookings' headcounts rather than a stored counter
// (same technique OutletAppointment already uses for its own soft-warning), so they
// can never drift from reality.
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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const departures = await prisma.excursionDeparture.findMany({
      where: {
        status: "SCHEDULED",
        departureDate: { gte: today },
        excursionType: { propertyId, isActive: true },
      },
      include: {
        excursionType: {
          select: { id: true, code: true, name: true, pricingMode: true, cutoffHours: true },
        },
        bookings: {
          where: { status: "CONFIRMED" },
          select: { adultCount: true, childCount: true, infantCount: true },
        },
      },
      orderBy: [{ departureDate: "asc" }, { departureTime: "asc" }],
    });

    const result = departures.map((d) => ({
      id: d.id,
      excursionTypeId: d.excursionTypeId,
      excursionType: d.excursionType,
      departureDate: d.departureDate,
      departureTime: d.departureTime,
      meetingTime: d.meetingTime,
      meetingPoint: d.meetingPoint,
      capacity: d.capacity,
      minCapacity: d.minCapacity,
      status: d.status,
      bookedHeadcount: d.bookings.reduce((sum, b) => sum + b.adultCount + b.childCount + b.infantCount, 0),
    }));

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
