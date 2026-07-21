import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const paidOutSchema = z.object({
  amount: z.number().finite().positive(),
  reason: z.string().min(1).max(300),
});

// Record a petty-cash disbursement from the drawer (paid-out). Requires an
// already-open shift — unlike payments, a disbursement with no shift context is
// a bookkeeping error, not something to silently auto-open a drawer for.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const parsed = paidOutSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid paid-out payload", details: parsed.error.flatten() }, { status: 400 });
    }
    const { amount, reason } = parsed.data;

    const shift = await prisma.cashierShift.findFirst({
      where: { enterpriseId: ctx.enterpriseId, userId: ctx.userId, closedAt: null },
    });
    if (!shift) {
      return NextResponse.json({ error: "Open a cashier shift before recording a paid-out" }, { status: 400 });
    }

    const paidOut = await prisma.cashierPaidOut.create({
      data: { shiftId: shift.id, amount, reason, createdByUserId: ctx.userId },
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "PAID_OUT",
      entityType: "CashierPaidOut",
      entityId: paidOut.id,
      description: `Paid out $${amount.toFixed(2)} from drawer — ${reason}`,
    });

    return NextResponse.json(paidOut, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
