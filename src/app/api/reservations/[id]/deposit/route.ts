import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { ensureOpenShift } from "@/lib/cashier-shift";
import { logActivity } from "@/lib/activity-log";

const DEPOSIT_PURPOSES = ["DEPOSIT", "PRE_ARRIVAL_FEE", "CANCELLATION_FEE", "NO_SHOW_FEE"] as const;

const depositSchema = z.object({
  paymentMethodId: z.string().min(1),
  amount: z.number().finite().positive(),
  referenceNumber: z.string().max(100).optional().nullable(),
  // What this pre-arrival collection is, for identification. Defaults to DEPOSIT.
  purpose: z.enum(DEPOSIT_PURPOSES).optional(),
});

const PURPOSE_LABEL: Record<string, string> = {
  DEPOSIT: "deposit",
  PRE_ARRIVAL_FEE: "pre-arrival fee",
  CANCELLATION_FEE: "cancellation fee",
  NO_SHOW_FEE: "no-show fee",
};

// Collect a deposit on a not-yet-arrived reservation. A deposit is an ordinary
// Payment on the reservation's own folio #1 — the folio is created here if the
// stay hasn't opened one yet, so at check-in the money is already sitting on the
// billing window with no transfer step. Once the guest is IN_HOUSE, payments go
// through the normal folio payments route instead.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const { id } = await params;
    const parsed = depositSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid deposit payload", details: parsed.error.flatten() }, { status: 400 });
    }
    const { paymentMethodId, amount, referenceNumber } = parsed.data;
    const purpose = parsed.data.purpose ?? "DEPOSIT";

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: { folios: { orderBy: { folioNumber: "asc" } } },
    });
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (reservation.status !== "RESERVED") {
      return NextResponse.json(
        { error: "Deposits can only be collected before arrival — for an in-house guest, post a payment on the folio instead" },
        { status: 400 }
      );
    }

    const paymentMethod = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
    if (!paymentMethod || paymentMethod.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    // Same shift discipline as the folio payments route: the caller's own open drawer
    // for this reservation's property, auto-opened at 0 float if needed.
    const shift = await ensureOpenShift(ctx, reservation.propertyId);

    const { payment } = await prisma.$transaction(async (tx) => {
      let folio = reservation.folios.find((f) => !f.isClosed) ?? null;
      if (!folio) {
        folio = await tx.folio.create({
          data: {
            reservationId: id,
            propertyId: reservation.propertyId,
            folioNumber: (reservation.folios[reservation.folios.length - 1]?.folioNumber ?? 0) + 1,
            isClosed: false,
          },
        });
      }
      const payment = await tx.payment.create({
        data: {
          folioId: folio.id,
          paymentMethodId,
          shiftId: shift.id,
          amount,
          referenceNumber: referenceNumber || null,
          depositPurpose: purpose,
        },
        include: { paymentMethod: true },
      });
      return { payment };
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "DEPOSIT",
      entityType: "Payment",
      entityId: payment.id,
      description: `Collected $${amount.toFixed(2)} ${PURPOSE_LABEL[purpose]} (${paymentMethod.name}) on ${reservation.confirmationNo}${referenceNumber ? ` ref ${referenceNumber}` : ""}`,
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
