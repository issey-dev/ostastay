import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { summarizeShiftPayments, expectedCashForShift } from "@/lib/shift-summary";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const body = await request.json();
    const closingDrop = parseFloat(body.closingDrop);

    if (isNaN(closingDrop) || closingDrop < 0) {
      return NextResponse.json({ error: "Invalid closing drop amount" }, { status: 400 });
    }

    const userId = ctx.userId;

    // 1. Fetch their active shift for the property they're working
    const propertyId = await resolveCurrentPropertyId(ctx);
    const activeShift = await prisma.cashierShift.findFirst({
      where: {
        userId,
        ...(propertyId ? { propertyId } : {}),
        closedAt: null
      },
      orderBy: { openedAt: "desc" },
      include: {
        payments: {
          include: {
            paymentMethod: true
          }
        },
        currencyExchanges: true,
        paidOuts: true
      }
    });

    if (!activeShift) {
      return NextResponse.json({ error: "No active shift found to close." }, { status: 400 });
    }

    // 2. Expected Cash = Opening Float + cash in − cash refunds, via the shared
    // shift-summary helper so history and close views can never disagree.
    const { byMethod } = summarizeShiftPayments(activeShift.payments);
    const expectedCash = expectedCashForShift(activeShift.openingFloat, activeShift.payments, activeShift.paidOuts);
    const paidOutTotal = activeShift.paidOuts.reduce((sum, p) => sum + p.amount, 0);
    const discrepancy = closingDrop - expectedCash; // Negative = Short, Positive = Over

    // 3. Close the shift (Blind Drop calculation saved)
    const closedShift = await prisma.cashierShift.update({
      where: { id: activeShift.id },
      data: {
        closedAt: new Date(),
        closingDrop: closingDrop
      }
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "SHIFT_CLOSE",
      entityType: "CashierShift",
      entityId: closedShift.id,
      description: `Closed cashier shift — drop $${closingDrop.toFixed(2)}, expected $${expectedCash.toFixed(2)}, ${discrepancy === 0 ? "balanced" : discrepancy > 0 ? `over $${discrepancy.toFixed(2)}` : `short $${Math.abs(discrepancy).toFixed(2)}`}`,
    });

    return NextResponse.json({
      success: true,
      data: {
        expectedCash,
        actualDrop: closingDrop,
        discrepancy,
        byMethod,
        paidOutTotal,
        shift: closedShift
      }
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
