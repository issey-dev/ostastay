import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "update");

    const body = await request.json();
    const closingDrop = parseFloat(body.closingDrop);

    if (isNaN(closingDrop) || closingDrop < 0) {
      return NextResponse.json({ error: "Invalid closing drop amount" }, { status: 400 });
    }

    const enterpriseId = ctx.enterpriseId;
    const userId = ctx.userId;

    // 1. Fetch their active shift
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
        },
        currencyExchanges: true
      }
    });

    if (!activeShift) {
      return NextResponse.json({ error: "No active shift found to close." }, { status: 400 });
    }

    // 2. Calculate Expected Cash
    // Expected Cash = Opening Float + (Total Cash Payments In - Total Cash Payments Refunded)
    // For simplicity, let's assume paymentMethod.type === "CASH" (or we check the name if type isn't reliable)
    let totalCashIn = 0;
    let totalCashOut = 0;

    activeShift.payments.forEach(payment => {
      // Typically, only "CASH" impacts the physical drawer drop
      if (payment.paymentMethod.type.toUpperCase() === "CASH" || payment.paymentMethod.name.toUpperCase().includes("CASH")) {
        if (payment.isRefund) {
          totalCashOut += payment.amount;
        } else {
          totalCashIn += payment.amount;
        }
      }
    });

    const expectedCash = activeShift.openingFloat + totalCashIn - totalCashOut;
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
        shift: closedShift
      }
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
