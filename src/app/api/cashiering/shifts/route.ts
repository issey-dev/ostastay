import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { summarizeShiftPayments, expectedCashForShift } from "@/lib/shift-summary";

export const dynamic = "force-dynamic";

// The caller's own shift history (most recent first) with the same reconciliation
// math the close route uses — the persisted end-of-shift record the close view
// previously only showed once, transiently.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "view");

    const { searchParams } = new URL(request.url);
    const take = Math.min(50, Math.max(1, parseInt(searchParams.get("take") ?? "20", 10) || 20));

    const shifts = await prisma.cashierShift.findMany({
      where: { enterpriseId: ctx.enterpriseId, userId: ctx.userId, closedAt: { not: null } },
      include: {
        payments: { include: { paymentMethod: { select: { name: true, type: true } } } },
        currencyExchanges: { select: { id: true } },
      },
      orderBy: { closedAt: "desc" },
      take,
    });

    const rows = shifts.map((shift) => {
      const { byMethod } = summarizeShiftPayments(shift.payments);
      const expectedCash = expectedCashForShift(shift.openingFloat, shift.payments);
      const discrepancy = shift.closingDrop != null ? shift.closingDrop - expectedCash : null;
      return {
        id: shift.id,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        openingFloat: shift.openingFloat,
        closingDrop: shift.closingDrop,
        expectedCash,
        discrepancy,
        paymentCount: shift.payments.length,
        exchangeCount: shift.currencyExchanges.length,
        byMethod,
      };
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
