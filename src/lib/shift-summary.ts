// Shared shift math for cashiering: the close route, the shift-history endpoint,
// and (indirectly) the reconciliation UI all agree on one definition of "expected
// cash" and the per-payment-method breakdown. All sums are done in integer cents
// (see src/lib/money.ts) so a drawer with many payments reconciles exactly.

import { toCents, fromCents } from "@/lib/money";

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
  let cashInCents = 0;
  let cashOutCents = 0;
  const byMethodMap = new Map<string, { method: string; receivedCents: number; refundedCents: number; netCents: number }>();

  for (const payment of payments) {
    const cents = toCents(payment.amount);
    const row = byMethodMap.get(payment.paymentMethod.name) ?? {
      method: payment.paymentMethod.name,
      receivedCents: 0,
      refundedCents: 0,
      netCents: 0,
    };
    if (payment.isRefund) {
      row.refundedCents += cents;
      row.netCents -= cents;
    } else {
      row.receivedCents += cents;
      row.netCents += cents;
    }
    byMethodMap.set(payment.paymentMethod.name, row);

    if (isCashMethod(payment.paymentMethod)) {
      if (payment.isRefund) cashOutCents += cents;
      else cashInCents += cents;
    }
  }

  const byMethod: MethodBreakdownRow[] = Array.from(byMethodMap.values())
    .map((r) => ({ method: r.method, received: fromCents(r.receivedCents), refunded: fromCents(r.refundedCents), net: fromCents(r.netCents) }))
    .sort((a, b) => b.net - a.net);

  return { cashIn: fromCents(cashInCents), cashOut: fromCents(cashOutCents), byMethod };
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
  let netCents = 0;
  for (const x of exchanges) {
    if ((x.fromCurrency ?? "").trim().toUpperCase() === base) netCents += toCents(x.amountFrom);
    if ((x.toCurrency ?? "").trim().toUpperCase() === base) netCents -= toCents(x.amountTo);
  }
  return fromCents(netCents);
}

export function expectedCashForShift(
  openingFloat: number,
  payments: ShiftPayment[],
  paidOuts: { amount: number }[] = [],
  exchanges: ExchangeLeg[] = [],
  baseCurrency: string | null = null
): number {
  const { cashIn, cashOut } = summarizeShiftPayments(payments);
  const paidOutCents = paidOuts.reduce((c, p) => c + toCents(p.amount), 0);
  // cashIn/cashOut/netBaseCash are already cent-exact; combine the whole drop in cents.
  return fromCents(
    toCents(openingFloat) + toCents(cashIn) - toCents(cashOut) - paidOutCents + toCents(netBaseCashFromExchanges(exchanges, baseCurrency))
  );
}
