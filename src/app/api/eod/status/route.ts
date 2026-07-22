import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate } from "@/lib/business-date";
import { getActiveEodRun, stepStates, nextEodStep } from "@/lib/eod";

export const dynamic = "force-dynamic";

// Everything the EOD wizard needs to render its progress and gate its steps.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) return NextResponse.json({ error: "Property not found" }, { status: 404 });
    const businessDate = resolveBusinessDate(property);

    const run = await getActiveEodRun(propertyId);

    // Guests due out on/before the business date who are still in-house — each must be
    // force-checked-out or extended before EOD can post.
    const pendingDepartures = await prisma.reservation.findMany({
      where: { propertyId, status: "IN_HOUSE", checkOutDate: { lte: businessDate } },
      include: {
        primaryGuest: { select: { firstName: true, lastName: true, companyName: true, profileType: true } },
        assignments: { orderBy: { startDate: "desc" }, take: 1, include: { room: { select: { roomNumber: true } } } },
      },
      orderBy: { checkOutDate: "asc" },
    });

    // Arrivals due in that never checked in — these auto-become no-shows in the post step.
    const pendingArrivals = await prisma.reservation.count({
      where: { propertyId, status: "RESERVED", checkInDate: { lte: businessDate } },
    });

    // Open cashier shifts for this property's staff — force-closed in the cashier step.
    // CashierShift.userId is a bare string (no relation), so filter by property staff
    // ids manually.
    const propertyUserIds = new Set(
      (await prisma.user.findMany({ where: { propertyId, scope: "PROPERTY" }, select: { id: true } })).map((u) => u.id)
    );
    const openShifts = (await prisma.cashierShift.findMany({ where: { closedAt: null }, orderBy: { openedAt: "asc" } }))
      .filter((s) => propertyUserIds.has(s.userId));

    return NextResponse.json({
      businessDate,
      run: run
        ? { id: run.id, businessDate: run.businessDate, status: run.status, startedAt: run.startedAt }
        : null,
      steps: stepStates(run),
      nextStep: run ? nextEodStep(run) : "departures",
      pendingDepartures: pendingDepartures.map((r) => ({
        id: r.id,
        confirmationNo: r.confirmationNo,
        guestName:
          r.primaryGuest.profileType === "COMPANY" || r.primaryGuest.profileType === "TRAVEL_AGENT"
            ? r.primaryGuest.companyName
            : `${r.primaryGuest.firstName} ${r.primaryGuest.lastName ?? ""}`.trim(),
        roomNumber: r.assignments[0]?.room?.roomNumber ?? null,
        checkOutDate: r.checkOutDate,
      })),
      pendingArrivals,
      openShifts: openShifts.map((s) => ({ id: s.id, userId: s.userId, openedAt: s.openedAt, openingFloat: s.openingFloat })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
