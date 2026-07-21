import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate, nextBusinessDate } from "@/lib/business-date";

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    // The property's operational business date, and the day the audit rolls it to.
    const businessDate = resolveBusinessDate(property);
    const nextDay = nextBusinessDate(businessDate);

    // 2. Get past logs for this property — matches what /api/night-audit/run actually
    // writes to (PropertyNightAuditLog, not the older enterprise-wide NightAuditLog).
    const logs = await prisma.propertyNightAuditLog.findMany({
      where: { propertyId },
      orderBy: { executedAt: "desc" },
      take: 10
    });

    // Has EOD already been run for the current business date?
    const alreadyRun = await prisma.propertyNightAuditLog.findFirst({
      where: { propertyId, status: "COMPLETED", auditDate: { gte: businessDate, lt: nextDay } },
    });

    // 3. Pending departures — in-house guests due out on or before the business date.
    const pendingDepartures = await prisma.reservation.count({
      where: {
        propertyId,
        status: "IN_HOUSE",
        checkOutDate: { lte: businessDate }
      }
    });

    // 4. Pending arrivals — reservations due in on or before the business date that
    //    haven't checked in yet.
    const pendingArrivals = await prisma.reservation.count({
      where: {
        propertyId,
        status: "RESERVED",
        checkInDate: { lte: businessDate }
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        businessDate,
        // Kept for backward compatibility with any existing client field reads.
        systemDate: businessDate,
        alreadyRun: !!alreadyRun,
        pendingDepartures,
        pendingArrivals,
        logs
      }
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
