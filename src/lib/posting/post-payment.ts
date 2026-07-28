import { Prisma } from "@prisma/client";
import type { Payment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PAYMENT_METHOD_CODES, PAYMENT_METHOD_FALLBACK_CODE } from "@/lib/posting/charge-tree";

// The money-IN counterpart to postCharge. Every financial posting is linked to a charge
// code — a payment just as much as a charge to the guest (owner rule, 2026-07-27) — so
// no route writes a Payment row directly any more.
//
// A payment is NOT a taxable event and never generates. Its charge code is NON_REVENUE,
// which canGenerateTax() refuses outright: the money being settled was already taxed on
// the charge it settles, and taxing it again would double-count. That is why this is a
// separate, deliberately much smaller function than postCharge rather than a mode of it.

type Client = Prisma.TransactionClient | typeof prisma;

export type PostPaymentInput = {
  folioId: string;
  paymentMethodId: string;
  shiftId: string;
  /** Always positive. `isRefund` decides the direction. */
  amount: number;
  isRefund?: boolean;
  referenceNumber?: string | null;
  /** DEPOSIT | PRE_ARRIVAL_FEE | CANCELLATION_FEE | NO_SHOW_FEE for pre-arrival money. */
  depositPurpose?: string | null;
};

/**
 * Record a payment, stamped with the charge code its method settles against.
 *
 * The code is copied onto the Payment rather than read back through the method, for the
 * same reason a folio line carries its own charge code: re-pointing a method later must
 * not silently rewrite settled history.
 */
export async function postPayment(client: Client, input: PostPaymentInput): Promise<Payment> {
  return client.payment.create({
    data: {
      folioId: input.folioId,
      paymentMethodId: input.paymentMethodId,
      shiftId: input.shiftId,
      chargeCodeId: await resolvePaymentChargeCodeId(client, input.paymentMethodId),
      amount: input.amount,
      isRefund: input.isRefund ?? false,
      referenceNumber: input.referenceNumber ?? null,
      depositPurpose: input.depositPurpose ?? null,
    },
  });
}

/**
 * The charge code a payment through this method posts against: the method's own link,
 * falling back to the seeded code for its type.
 *
 * The fallback matters for a method created before the link existed, or one an admin
 * hasn't pointed yet — a payment must still be identifiable in the ledger rather than
 * posting with no code at all.
 */
export async function resolvePaymentChargeCodeId(
  client: Client,
  paymentMethodId: string
): Promise<string | null> {
  const method = await client.paymentMethod.findUnique({
    where: { id: paymentMethodId },
    select: { chargeCodeId: true, type: true, enterpriseId: true },
  });
  if (!method) return null;
  if (method.chargeCodeId) return method.chargeCodeId;

  const fallback = await client.chargeCode.findUnique({
    where: {
      enterpriseId_code: {
        enterpriseId: method.enterpriseId,
        code: PAYMENT_METHOD_CODES[method.type] ?? PAYMENT_METHOD_FALLBACK_CODE,
      },
    },
    select: { id: true },
  });
  return fallback?.id ?? null;
}
