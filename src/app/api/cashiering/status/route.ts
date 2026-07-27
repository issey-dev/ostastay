import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import { LINE_BUCKET_INCLUDE, lineReportBucket } from "@/lib/posting/report-bucket";
import { summarizeShiftPayments, expectedCashForShift } from "@/lib/shift-summary";

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "view");

    const propertyId = await resolveCurrentPropertyId(ctx);
    if (!propertyId) {
      return NextResponse.json({ success: true, data: { hasActiveShift: false, shift: null, propertyId: null } });
    }

    // The caller's open drawer for THIS property (shifts are per user + property).
    const activeShift = await prisma.cashierShift.findFirst({
      where: { userId: ctx.userId, propertyId, closedAt: null },
      orderBy: { openedAt: "desc" },
      include: {
        payments: { include: { paymentMethod: true } },
        currencyExchanges: { orderBy: { createdAt: "desc" } },
        paidOuts: { orderBy: { createdAt: "desc" } },
        lineItems: { include: { ...LINE_BUCKET_INCLUDE, chargeCode: { select: { ...LINE_BUCKET_INCLUDE.chargeCode.select, description: true } } } },
        property: { select: { defaultCurrency: true } },
      },
    });

    let summary = null;
    if (activeShift) {
      // Postings this cashier made during the shift, grouped by charge code.
      const byCodeMap = new Map<string, { code: string; description: string; category: string; count: number; amount: number; tax: number; serviceCharge: number; total: number }>();
      for (const li of activeShift.lineItems) {
        if (li.isVoid) continue;
        const key = li.chargeCode?.code ?? "—";
        const row = byCodeMap.get(key) ?? { code: key, description: li.chargeCode?.description ?? key, category: lineReportBucket(li), count: 0, amount: 0, tax: 0, serviceCharge: 0, total: 0 };
        row.count += 1;
        row.amount += li.amount;
        row.tax += li.taxAmount;
        row.serviceCharge += li.serviceChargeAmount || 0;
        row.total += li.amount + li.taxAmount + (li.serviceChargeAmount || 0);
        byCodeMap.set(key, row);
      }
      const postingsByChargeCode = Array.from(byCodeMap.values()).sort((a, b) => b.total - a.total);
      const chargesTotal = postingsByChargeCode.reduce((s, r) => s + r.total, 0);

      // Payment Summary — how much they collected, by method.
      const { byMethod } = summarizeShiftPayments(activeShift.payments);
      const paymentsNet = byMethod.reduce((s, m) => s + m.net, 0);
      const expectedCash = expectedCashForShift(activeShift.openingFloat, activeShift.payments, activeShift.paidOuts, activeShift.currencyExchanges, activeShift.property?.defaultCurrency ?? null);

      summary = {
        postingsByChargeCode,
        chargesTotal,
        paymentSummary: byMethod,
        paymentsNet,
        expectedCash,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        hasActiveShift: !!activeShift,
        shift: activeShift,
        propertyId,
        summary,
      },
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
