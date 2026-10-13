import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const paidOutSchema = z.object({
  amount: z.number().finite().positive(),
  reason: z.string().min(1).max(300),
  // Optional: the in-house guest the cash went to.
  reservationId: z.string().min(1).optional().nullable(),
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
    const { amount, reason, reservationId } = parsed.data;

    const shift = await prisma.cashierShift.findFirst({
      where: { enterpriseId: ctx.enterpriseId, userId: ctx.userId, closedAt: null },
    });
    if (!shift) {
      return NextResponse.json({ error: "Open a cashier shift before recording a paid-out" }, { status: 400 });
    }

    // A linked guest must be in-house at the shift's property.
    let guestLabel = "";
    if (reservationId) {
      const reservation = await prisma.reservation.findUnique({
        where: { id: reservationId },
        select: { propertyId: true, status: true, primaryGuest: { select: { firstName: true, lastName: true, companyName: true } } },
      });
      if (!reservation || reservation.propertyId !== shift.propertyId) {
        return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
      }
      if (reservation.status !== "IN_HOUSE") {
        return NextResponse.json({ error: "Only an in-house guest can be linked to a paid-out." }, { status: 400 });
      }
      const g = reservation.primaryGuest;
      guestLabel = g ? g.companyName || `${g.firstName} ${g.lastName ?? ""}`.trim() : "";
    }

    const paidOut = await prisma.cashierPaidOut.create({
      data: { shiftId: shift.id, amount, reason, reservationId: reservationId || null, createdByUserId: ctx.userId },
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "PAID_OUT",
      entityType: "CashierPaidOut",
      entityId: paidOut.id,
      description: `Paid out $${amount.toFixed(2)} from drawer — ${reason}${guestLabel ? ` (in-house guest ${guestLabel})` : ""}`,
    });

    return NextResponse.json(paidOut, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
