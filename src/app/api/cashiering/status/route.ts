import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "view");

    const enterpriseId = ctx.enterpriseId;
    const userId = ctx.userId;

    // Find active shift for THIS user (where closedAt is null)
    const activeShift = await prisma.cashierShift.findFirst({
      where: {
        enterpriseId,
        userId,
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
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
