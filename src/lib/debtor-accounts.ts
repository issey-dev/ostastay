import { toCents, fromCents } from "@/lib/money";

// A debtor invoice IS a reservation's own Folio — settlementMethod: "CITY_LEDGER" and
// payeeProfileId are set at reservation creation (see reservations/route.ts), but
// isDebtorAccount only flips true at checkout (see reservations/[id]/check-out/
// route.ts), which is the moment charges actually transfer to the account. Before
// checkout the folio behaves like any other guest folio — this is what keeps
// in-house reservations out of the Debtors module entirely.

// Same formula reservations/[id]/check-out/route.ts uses for its balance check —
// unvoided charges (amount + tax + service charge) minus non-refund payments, with
// refunds adding back to the outstanding balance.
export function computeFolioBalance(
  lineItems: Array<{ amount: number; taxAmount: number; serviceChargeAmount: number; isVoid: boolean }>,
  payments: Array<{ amount: number; isRefund: boolean }>
): number {
  // Sum in integer cents so a folio with many lines/payments nets exactly (no float drift).
  let chargeCents = 0;
  for (const item of lineItems) {
    if (!item.isVoid) {
      chargeCents += toCents(item.amount) + toCents(item.taxAmount) + toCents(item.serviceChargeAmount);
    }
  }
  let paymentCents = 0;
  for (const payment of payments) {
    paymentCents += payment.isRefund ? -toCents(payment.amount) : toCents(payment.amount);
  }
  return fromCents(chargeCents - paymentCents);
}

// Non-blocking credit-limit check — mirrors the Outlet appointment-capacity
// `capWarning` pattern (src/app/api/outlets/[id]/appointments/route.ts): the caller
// always proceeds, this only tells the UI whether to show a warning.
export function checkCreditLimitWarning(
  balance: number,
  creditLimit: number | null
): { balance: number; creditLimit: number } | undefined {
  if (creditLimit == null) return undefined;
  if (balance <= creditLimit) return undefined;
  return { balance, creditLimit };
}

// A City-Ledger payment is not money received — it is the act of TRANSFERRING the debt
// to an account. On the guest's folio it settles the bill (which is why check-out and
// every guest-payable balance count it normally, via computeFolioBalance); on the AR
// invoice it must be ignored, or the receivable it just created would read as paid.
// See .agents/docs/DECISIONS.md, 2026-08-03.
export const CITY_LEDGER_METHOD_TYPE = "CITY_LEDGER";

export type BalancePayment = {
  amount: number;
  isRefund: boolean;
  paymentMethod?: { type: string } | null;
};

export function isCityLedgerPayment(p: BalancePayment): boolean {
  return p.paymentMethod?.type === CITY_LEDGER_METHOD_TYPE;
}

// What the ACCOUNT still owes: charges, less every payment except the City-Ledger
// transfer that moved the balance here in the first place. Callers must select the
// payment method's type — a payments list without it cannot distinguish a transfer from
// cash, and would silently report a settled invoice.
export function computeReceivableBalance(
  lineItems: Array<{ amount: number; taxAmount: number; serviceChargeAmount: number; isVoid: boolean }>,
  payments: BalancePayment[]
): number {
  return computeFolioBalance(lineItems, payments.filter((p) => !isCityLedgerPayment(p)));
}

export type DebtorInvoiceFolio = {
  id: string;
  lineItems: Array<{ amount: number; taxAmount: number; serviceChargeAmount: number; isVoid: boolean }>;
  payments: BalancePayment[];
  reservation: {
    confirmationNo: string;
    checkInDate: Date;
    checkOutDate: Date;
    primaryGuest: { firstName: string; lastName: string | null };
  } | null;
};

export type DebtorInvoiceSummary = {
  folioId: string;
  confirmationNo: string | null;
  guestName: string;
  checkInDate: Date | null;
  checkOutDate: Date | null;
  total: number;
  balance: number;
  isOpen: boolean;
};

// One invoice = one finalized (isDebtorAccount: true) Folio, always tied to the
// reservation it was billed from — see the module comment above. `reservation` is
// only ever null for stale pre-redesign test data; every real invoice has one.
export function buildInvoiceSummary(folio: DebtorInvoiceFolio): DebtorInvoiceSummary {
  const total = fromCents(
    folio.lineItems
      .filter((li) => !li.isVoid)
      .reduce((cents, li) => cents + toCents(li.amount) + toCents(li.taxAmount) + toCents(li.serviceChargeAmount), 0)
  );
  // Receivable, not guest-payable: the City-Ledger payment that settled the guest's bill
  // is what CREATED this invoice, so counting it here would show every account as
  // square the moment it was billed.
  const balance = computeReceivableBalance(folio.lineItems, folio.payments);
  const guestName = folio.reservation
    ? [folio.reservation.primaryGuest.firstName, folio.reservation.primaryGuest.lastName].filter(Boolean).join(" ")
    : "Unknown Guest";
  return {
    folioId: folio.id,
    confirmationNo: folio.reservation?.confirmationNo ?? null,
    guestName,
    checkInDate: folio.reservation?.checkInDate ?? null,
    checkOutDate: folio.reservation?.checkOutDate ?? null,
    total,
    balance,
    isOpen: balance > 0.005,
  };
}
