import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { authorizePropertyParam } from "@/lib/channels/hub-access";

// Bookings received through one property's channel-manager connection (?propertyId=,
// Property Setup with INTEGRATIONS there — src/lib/channels/hub-access.ts). Scoped by the
// CONNECTION's property, so a booking the parser could not place still shows at the
// property whose channel manager sent it.
//
// Read-only. The raw payload is deliberately NOT returned by default — it is stored so a
// mis-parse is recoverable, not so it can be browsed; it carries the guest's full details
// and there is no reason to ship all of that to a list view.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = await authorizePropertyParam(ctx, request, "view");
    const scope = { enterpriseId: ctx.enterpriseId, connection: { propertyId } };

    const { searchParams } = new URL(request.url);
    const onlyProblems = searchParams.get("filter") === "problems";
    const onlyOverbookings = searchParams.get("filter") === "overbookings";
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 200);

    const rows = await prisma.channelInboundBooking.findMany({
      where: {
        ...scope,
        ...(onlyOverbookings ? { isOverbooking: true } : {}),
        ...(onlyProblems ? { problem: { not: null } } : {}),
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
      select: {
        id: true,
        externalBookingId: true,
        channelName: true,
        source: true,
        status: true,
        externalRoomId: true,
        guestFirstName: true,
        guestLastName: true,
        arrival: true,
        departure: true,
        adults: true,
        children: true,
        totalAmount: true,
        currency: true,
        channelStatus: true,
        problem: true,
        isOverbooking: true,
        overbookingNote: true,
        acknowledgedAt: true,
        receivedAt: true,
        roomType: { select: { name: true } },
        property: { select: { name: true } },
        // The reservation this booking was converted into (status CONVERTED).
        reservation: { select: { confirmationNo: true } },
      },
    });

    // Counts drive the badges in the Hub. An unacknowledged overbooking is the one thing
    // here that needs a human today, so it is surfaced separately from the plain total.
    const [unacknowledgedOverbookings, withProblems] = await Promise.all([
      prisma.channelInboundBooking.count({
        where: { ...scope, isOverbooking: true, acknowledgedAt: null },
      }),
      prisma.channelInboundBooking.count({
        where: { ...scope, problem: { not: null } },
      }),
    ]);

    return NextResponse.json({
      bookings: rows.map((r) => ({
        ...r,
        arrival: r.arrival?.toISOString() ?? null,
        departure: r.departure?.toISOString() ?? null,
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
        receivedAt: r.receivedAt.toISOString(),
        roomTypeName: r.roomType?.name ?? null,
        propertyName: r.property?.name ?? null,
      })),
      unacknowledgedOverbookings,
      withProblems,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
