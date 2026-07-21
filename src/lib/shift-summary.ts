// Shared shift math for cashiering: the close route, the shift-history endpoint,
// and (indirectly) the reconciliation UI all agree on one definition of "expected
// cash" and the per-payment-method breakdown.

type ShiftPayment = {
  amount: number;
  isRefund: boolean;
  paymentMethod: { name: string; type: string };
};

export type MethodBreakdownRow = {
  method: string;
  received: number;
  refunded: number;
  net: number;
};

// Only physical cash affects the drawer drop. Method `type` is authoritative;
// the name check is a fallback for loosely-configured methods.
export function isCashMethod(method: { name: string; type: string }): boolean {
  return method.type.toUpperCase() === "CASH" || method.name.toUpperCase().includes("CASH");
}

export function summarizeShiftPayments(payments: ShiftPayment[]) {
  let cashIn = 0;
  let cashOut = 0;
  const byMethodMap = new Map<string, MethodBreakdownRow>();

  for (const payment of payments) {
    const row = byMethodMap.get(payment.paymentMethod.name) ?? {
      method: payment.paymentMethod.name,
      received: 0,
      refunded: 0,
      net: 0,
    };
    if (payment.isRefund) {
      row.refunded += payment.amount;
      row.net -= payment.amount;
    } else {
      row.received += payment.amount;
      row.net += payment.amount;
    }
    byMethodMap.set(payment.paymentMethod.name, row);

    if (isCashMethod(payment.paymentMethod)) {
      if (payment.isRefund) cashOut += payment.amount;
      else cashIn += payment.amount;
    }
  }

  return {
    cashIn,
    cashOut,
    byMethod: Array.from(byMethodMap.values()).sort((a, b) => b.net - a.net),
  };
}

export function expectedCashForShift(
  openingFloat: number,
  payments: ShiftPayment[],
  paidOuts: { amount: number }[] = []
): number {
  const { cashIn, cashOut } = summarizeShiftPayments(payments);
  const paidOutTotal = paidOuts.reduce((sum, p) => sum + p.amount, 0);
  return openingFloat + cashIn - cashOut - paidOutTotal;
}
