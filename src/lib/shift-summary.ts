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

type ExchangeLeg = { fromCurrency: string; toCurrency: string; amountFrom: number; amountTo: number };

// A currency exchange moves physical cash through the same drawer, so it must count
// toward expected cash or every shift that did one reports a false over/short. Only the
// BASE-currency leg touches the base-currency drawer total: local cash taken in
// (fromCurrency == base) adds, local cash paid out (toCurrency == base) subtracts.
// Foreign-to-foreign legs don't affect the base drawer. Without a known base currency we
// can't identify the base leg, so contribute 0 (old behavior) rather than guess.
export function netBaseCashFromExchanges(exchanges: ExchangeLeg[], baseCurrency: string | null | undefined): number {
  if (!baseCurrency) return 0;
  const base = baseCurrency.trim().toUpperCase();
  let net = 0;
  for (const x of exchanges) {
    if ((x.fromCurrency ?? "").trim().toUpperCase() === base) net += x.amountFrom;
    if ((x.toCurrency ?? "").trim().toUpperCase() === base) net -= x.amountTo;
  }
  return net;
}

export function expectedCashForShift(
  openingFloat: number,
  payments: ShiftPayment[],
  paidOuts: { amount: number }[] = [],
  exchanges: ExchangeLeg[] = [],
  baseCurrency: string | null = null
): number {
  const { cashIn, cashOut } = summarizeShiftPayments(payments);
  const paidOutTotal = paidOuts.reduce((sum, p) => sum + p.amount, 0);
  return openingFloat + cashIn - cashOut - paidOutTotal + netBaseCashFromExchanges(exchanges, baseCurrency);
}
