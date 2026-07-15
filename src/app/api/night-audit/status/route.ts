import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = String(session.tenantId);

    // 1. Get current System Date
    let settings = await prisma.tenantSettings.findUnique({
      where: { tenantId }
    });

    if (!settings) {
      settings = await prisma.tenantSettings.create({
        data: { tenantId }
      });
    }

    // 2. Get past logs
    const logs = await prisma.nightAuditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 10
    });

    // 3. Look for pending departures (guests who should have checked out today but are still IN_HOUSE)
    // This is a common warning metric for Night Audit
    const pendingDepartures = await prisma.reservation.count({
      where: {
        property: { tenantId },
        status: "IN_HOUSE",
        checkOutDate: { lte: settings.systemDate }
      }
    });

    // 4. Look for pending arrivals (guests who should have arrived today but haven't)
    const pendingArrivals = await prisma.reservation.count({
      where: {
        property: { tenantId },
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
    console.error("Failed to fetch Night Audit status:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
