import { describe, it, expect } from "vitest";
import {
  computeFolioBalance,
  computeReceivableBalance,
  isCityLedgerPayment,
  buildInvoiceSummary,
  CITY_LEDGER_METHOD_TYPE,
} from "@/lib/debtor-accounts";

// Settling a folio to City Ledger is a TRANSFER, not a receipt (owner rule, 2026-08-03).
// The same payment therefore has to read two different ways:
//
//   * on the guest's bill it settles — check-out and every guest-payable balance must
//     see the folio net to zero, or the desk cannot check the guest out;
//   * on the account's invoice it must be invisible — it is the thing that CREATED the
//     receivable, so counting it would show every account as square the moment it was
//     billed.
//
// computeFolioBalance is the first view; computeReceivableBalance is the second.

const charge = (amount: number, tax = 0, sc = 0, isVoid = false) => ({
  amount, taxAmount: tax, serviceChargeAmount: sc, isVoid,
});

const pay = (amount: number, type: string, isRefund = false) => ({
  amount, isRefund, paymentMethod: { type },
});

const CASH = "CASH";
const CL = CITY_LEDGER_METHOD_TYPE;

describe("Identifying a City-Ledger settlement", () => {
  it("recognises one by its payment method's type", () => {
    expect(isCityLedgerPayment(pay(100, CL))).toBe(true);
    expect(isCityLedgerPayment(pay(100, CASH))).toBe(false);
  });

  it("treats a payment with no method loaded as ordinary, not as a transfer", () => {
    // Defaulting the other way would silently erase real receipts from the receivable.
    expect(isCityLedgerPayment({ amount: 100, isRefund: false })).toBe(false);
    expect(isCityLedgerPayment({ amount: 100, isRefund: false, paymentMethod: null })).toBe(false);
  });
});

describe("The two views of one City-Ledger settlement", () => {
  const lineItems = [charge(100, 17, 10)]; // 127 owed
  const payments = [pay(127, CL)];

  it("settles the guest's bill so check-out can proceed", () => {
    expect(computeFolioBalance(lineItems, payments)).toBeCloseTo(0, 2);
  });

  it("leaves the account owing the full amount", () => {
    expect(computeReceivableBalance(lineItems, payments)).toBeCloseTo(127, 2);
  });
});

describe("Receivable balance", () => {
  it("still counts real money the account has since paid against its invoice", () => {
    const lineItems = [charge(200)];
    // Billed to the ledger, then the agent settles half of it by bank transfer.
    const payments = [pay(200, CL), pay(80, CASH)];
    expect(computeReceivableBalance(lineItems, payments)).toBeCloseTo(120, 2);
    // The guest's bill was square the whole time.
    expect(computeFolioBalance(lineItems, payments)).toBeCloseTo(-80, 2);
  });

  it("adds a refunded City-Ledger transfer back — reversing it re-bills the guest", () => {
    const lineItems = [charge(100)];
    // A refund on a CL method is the transfer being undone; it is excluded on the same
    // grounds as the transfer itself, so the receivable is simply gone.
    expect(computeReceivableBalance(lineItems, [pay(100, CL), pay(100, CL, true)])).toBeCloseTo(100, 2);
  });

  it("ignores voided charges, like every other balance in the app", () => {
    const lineItems = [charge(100), charge(999, 0, 0, true)];
    expect(computeReceivableBalance(lineItems, [pay(100, CL)])).toBeCloseTo(100, 2);
  });

  it("matches the guest-payable balance when no City-Ledger payment is involved", () => {
    const lineItems = [charge(150, 20)];
    const payments = [pay(50, CASH)];
    expect(computeReceivableBalance(lineItems, payments)).toBeCloseTo(
      computeFolioBalance(lineItems, payments), 2
    );
  });
});

describe("The debtor invoice summary", () => {
  const folio = (payments: ReturnType<typeof pay>[]) => ({
    id: "f1",
    lineItems: [charge(300, 51, 30)], // 381
    payments,
    reservation: {
      confirmationNo: "DMH-000000000009",
      checkInDate: new Date("2026-08-01T00:00:00.000Z"),
      checkOutDate: new Date("2026-08-04T00:00:00.000Z"),
      primaryGuest: { firstName: "Aishath", lastName: "Bagir" },
    },
  });

  it("reports the full amount outstanding on a freshly billed invoice", () => {
    const s = buildInvoiceSummary(folio([pay(381, CL)]));
    expect(s.total).toBeCloseTo(381, 2);
    expect(s.balance).toBeCloseTo(381, 2);
    expect(s.isOpen).toBe(true);
  });

  it("closes only once the account has actually paid", () => {
    const s = buildInvoiceSummary(folio([pay(381, CL), pay(381, CASH)]));
    expect(s.balance).toBeCloseTo(0, 2);
    expect(s.isOpen).toBe(false);
  });

  it("still totals the charges regardless of how they were settled", () => {
    expect(buildInvoiceSummary(folio([])).total).toBeCloseTo(381, 2);
  });
});
