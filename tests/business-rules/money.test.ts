import { describe, it, expect } from "vitest";
import { toCents, fromCents, sumMoney, sumBy, subMoney, round2, moneyEquals, isZeroMoney } from "@/lib/money";

// A14 (targeted): money sums must be exact to the cent. Naive float summation drifts
// (0.1 + 0.2 === 0.30000000000000004), which is why folio balance / drawer totals used to
// need a 0.01 tolerance. These helpers sum in integer cents so the result is exact.
describe("money helpers — exact cent arithmetic", () => {
  it("sumMoney is exact where naive float summation drifts", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the underlying problem
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(Array(100).fill(0.1))).toBe(10); // 100 dimes = $10.00 exactly
    // A realistic folio: several charges that naively drift.
    expect(sumMoney([19.99, 5.55, 0.1, 0.2, 12.34, 100.01])).toBe(138.19);
  });

  it("subMoney nets exactly", () => {
    expect(0.3 - 0.1).not.toBe(0.2); // naive: 0.19999999999999998
    expect(subMoney(0.3, 0.1)).toBe(0.2);
    expect(subMoney(138.19, 138.19)).toBe(0);
  });

  it("sumBy sums a money field exactly (folio-balance shape)", () => {
    const lineItems = [
      { amount: 19.99, taxAmount: 3.4, serviceChargeAmount: 2.0 },
      { amount: 0.1, taxAmount: 0.0, serviceChargeAmount: 0.0 },
      { amount: 0.2, taxAmount: 0.0, serviceChargeAmount: 0.0 },
    ];
    const chargeCents = lineItems.reduce((c, li) => c + toCents(li.amount) + toCents(li.taxAmount) + toCents(li.serviceChargeAmount), 0);
    expect(fromCents(chargeCents)).toBe(25.69);
    expect(sumBy(lineItems, (li) => li.amount)).toBe(20.29);
  });

  it("toCents / fromCents round-trip and round2 cleans float noise", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
    expect(round2(0.30000000000000004)).toBe(0.3);
    expect(toCents(null)).toBe(0);
  });

  it("moneyEquals / isZeroMoney compare at cent precision", () => {
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(isZeroMoney(0.3 - 0.1 - 0.2)).toBe(true); // naive result is ~5.5e-17, not 0
  });
});
