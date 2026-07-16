import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "NIGHT_AUDIT", "view");
    const enterpriseId = ctx.enterpriseId;

    // 1. Get current System Date
    let settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId }
    });

    if (!settings) {
      settings = await prisma.enterpriseSettings.create({
        data: { enterpriseId }
      });
    }

    // 2. Get past logs
    const logs = await prisma.nightAuditLog.findMany({
      where: { enterpriseId },
      orderBy: { createdAt: "desc" },
      take: 10
    });

    // 3. Look for pending departures (guests who should have checked out today but are still IN_HOUSE)
    // This is a common warning metric for Night Audit
    const pendingDepartures = await prisma.reservation.count({
      where: {
        property: { enterpriseId },
        status: "IN_HOUSE",
        checkOutDate: { lte: settings.systemDate }
      }
    });

    // 4. Look for pending arrivals (guests who should have arrived today but haven't)
    const pendingArrivals = await prisma.reservation.count({
      where: {
        property: { enterpriseId },
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
