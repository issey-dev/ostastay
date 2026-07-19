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
  let totalCharges = 0;
  for (const item of lineItems) {
    if (!item.isVoid) {
      totalCharges += item.amount + item.taxAmount + (item.serviceChargeAmount || 0);
    }
  }
  let totalPayments = 0;
  for (const payment of payments) {
    totalPayments += payment.isRefund ? -payment.amount : payment.amount;
  }
  return totalCharges - totalPayments;
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

export type DebtorInvoiceFolio = {
  id: string;
  lineItems: Array<{ amount: number; taxAmount: number; serviceChargeAmount: number; isVoid: boolean }>;
  payments: Array<{ amount: number; isRefund: boolean }>;
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
  const total = folio.lineItems
    .filter((li) => !li.isVoid)
    .reduce((sum, li) => sum + li.amount + li.taxAmount + (li.serviceChargeAmount || 0), 0);
  const balance = computeFolioBalance(folio.lineItems, folio.payments);
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
