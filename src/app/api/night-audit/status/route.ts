import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

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

    // 1. Get current System Date
    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: ctx.enterpriseId }
    });

    if (!settings) {
      settings = await prisma.enterpriseSettings.create({
        data: { enterpriseId: ctx.enterpriseId }
      });
    }

    // 2. Get past logs for this property — matches what /api/night-audit/run actually
    // writes to (PropertyNightAuditLog, not the older enterprise-wide NightAuditLog).
    const logs = await prisma.propertyNightAuditLog.findMany({
      where: { propertyId },
      orderBy: { executedAt: "desc" },
      take: 10
    });

    // 3. Look for pending departures (guests who should have checked out today but are still IN_HOUSE)
    const pendingDepartures = await prisma.reservation.count({
      where: {
        propertyId,
        status: "IN_HOUSE",
        checkOutDate: { lte: settings.systemDate }
      }
    });

    // 4. Look for pending arrivals (guests who should have arrived today but haven't)
    const pendingArrivals = await prisma.reservation.count({
      where: {
        propertyId,
        status: "RESERVED",
        checkInDate: { lte: settings.systemDate }
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        systemDate: settings.systemDate,
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
