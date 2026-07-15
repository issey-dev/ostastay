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
    const userId = String(session.id);

    // Find active shift for THIS user (where closedAt is null)
    const activeShift = await prisma.cashierShift.findFirst({
      where: {
        tenantId: tenantId,
        userId: userId,
        closedAt: null
      },
      include: {
        payments: {
          include: {
            paymentMethod: true
          }
        }
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        hasActiveShift: !!activeShift,
        shift: activeShift
      }
    });

  } catch (error) {
    console.error("Cashiering Status Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
