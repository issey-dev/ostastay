import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";

// Lists departures for a property. Default (no from/to): upcoming, bookable
// SCHEDULED-only departures — the data source for the Excursions booking screen's
// departure picker, unchanged from before. With from/to (the Excursions Calendar view):
// every status within that exact date range, past or future, so cancelled departures
// can be rendered dimmed rather than hidden. Capacity/minCapacity counts are computed
// LIVE from non-cancelled bookings' headcounts rather than a stored counter, so they can
// never drift from reality.
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

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const isRangeQuery = !!fromParam && !!toParam;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const departures = await prisma.excursionDeparture.findMany({
      where: isRangeQuery
        ? {
            departureDate: { gte: new Date(fromParam), lte: new Date(toParam) },
            excursionType: { propertyId, isActive: true },
          }
        : {
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
