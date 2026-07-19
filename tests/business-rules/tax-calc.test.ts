import { describe, it, expect } from "vitest";
import { computeDefaultEngineTax, computeCustomProfileTax, resolveChargeTax } from "@/lib/tax-calc";

describe("tax-calc: default engine (Service Charge + GST)", () => {
  const settings = { serviceChargeEnabled: true, serviceChargeRate: 10, tgstEnabled: true, tgstRate: 17 };

  it("matches the documented example: $100 base, SVC 10% = $10, GST 17% of $110 = $18.70", () => {
    const result = computeDefaultEngineTax(100, settings, false);
    expect(result.baseAmount).toBe(100);
    expect(result.serviceChargeAmount).toBe(10);
    expect(result.taxAmount).toBe(18.7);
  });

  it("backs out taxes correctly when prices are inclusive", () => {
    const exclusive = computeDefaultEngineTax(100, settings, false);
    const grandTotal = exclusive.baseAmount + exclusive.serviceChargeAmount + exclusive.taxAmount;
    const inclusive = computeDefaultEngineTax(grandTotal, settings, true);
    expect(inclusive.baseAmount).toBeCloseTo(100, 2);
    expect(inclusive.serviceChargeAmount).toBeCloseTo(10, 2);
    expect(inclusive.taxAmount).toBeCloseTo(18.7, 2);
  });

  it("zeroes out disabled components", () => {
    const result = computeDefaultEngineTax(100, { serviceChargeEnabled: false, serviceChargeRate: 10, tgstEnabled: false, tgstRate: 17 }, false);
    expect(result.serviceChargeAmount).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.baseAmount).toBe(100);
  });

  it("treats a null settings row as no tax at all", () => {
    const result = computeDefaultEngineTax(100, null, false);
    expect(result.baseAmount).toBe(100);
    expect(result.serviceChargeAmount).toBe(0);
    expect(result.taxAmount).toBe(0);
  });
});

describe("tax-calc: custom multi-line profiles", () => {
  it("a single flat BASE line is a simple percentage of the subtotal", () => {
    const result = computeCustomProfileTax(100, [{ name: "State Tax", ratePercent: 8, calculateOn: "BASE", order: 0 }], false);
    expect(result.baseAmount).toBe(100);
    expect(result.taxAmount).toBe(8);
    expect(result.serviceChargeAmount).toBe(0);
    expect(result.breakdown).toEqual([{ name: "State Tax", ratePercent: 8, calculateOn: "BASE", amount: 8 }]);
  });

  it("reproduces the SVC+GST relationship generalized to two named lines", () => {
    const result = computeCustomProfileTax(
      100,
      [
        { name: "Service Charge", ratePercent: 10, calculateOn: "BASE", order: 0 },
        { name: "GST", ratePercent: 17, calculateOn: "COMPOUND", order: 1 },
      ],
      false
    );
    expect(result.taxAmount).toBe(28.7); // $10 SVC + $18.70 GST, both folded into one tax bucket
    expect(result.breakdown[0].amount).toBe(10);
    expect(result.breakdown[1].amount).toBe(18.7);
  });

  it("supports three or more lines, applied in ascending order regardless of input order", () => {
    const result = computeCustomProfileTax(
      100,
      [
        { name: "Third", ratePercent: 5, calculateOn: "COMPOUND", order: 2 },
        { name: "First", ratePercent: 10, calculateOn: "BASE", order: 0 },
        { name: "Second", ratePercent: 5, calculateOn: "BASE", order: 1 },
      ],
      false
    );
    // First: 10 (base). Second: 5 (base). Running total after both = 115.
    // Third (compound): 5% of 115 = 5.75.
    expect(result.breakdown.map((l) => l.name)).toEqual(["First", "Second", "Third"]);
    expect(result.breakdown[2].amount).toBe(5.75);
    expect(result.taxAmount).toBe(20.75);
  });

  it("backs out a multi-line inclusive price to the same subtotal as the exclusive calculation", () => {
    const lines = [
      { name: "Service Charge", ratePercent: 10, calculateOn: "BASE" as const, order: 0 },
      { name: "GST", ratePercent: 17, calculateOn: "COMPOUND" as const, order: 1 },
    ];
    const exclusive = computeCustomProfileTax(100, lines, false);
    const grandTotal = exclusive.baseAmount + exclusive.taxAmount;
    const inclusive = computeCustomProfileTax(grandTotal, lines, true);
    expect(inclusive.baseAmount).toBeCloseTo(100, 2);
    expect(inclusive.taxAmount).toBeCloseTo(28.7, 2);
  });

  it("an empty line set charges no tax", () => {
    const result = computeCustomProfileTax(100, [], false);
    expect(result.baseAmount).toBe(100);
    expect(result.taxAmount).toBe(0);
  });
});

describe("tax-calc: resolveChargeTax connection point", () => {
  const settings = { serviceChargeEnabled: true, serviceChargeRate: 10, tgstEnabled: true, tgstRate: 17 };

  it("uses the default engine when useDefaultTax is true, even if a taxProfile is present", () => {
    const result = resolveChargeTax({
      chargeCode: { useDefaultTax: true, taxProfile: { rates: [{ name: "Ignored", ratePercent: 99, calculateOn: "BASE", order: 0, effectiveFrom: new Date(0), effectiveTo: null }] } },
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    expect(result.taxAmount).toBe(18.7);
    expect(result.serviceChargeAmount).toBe(10);
  });

  it("uses the custom profile when useDefaultTax is false", () => {
    const result = resolveChargeTax({
      chargeCode: {
        useDefaultTax: false,
        taxProfile: { rates: [{ name: "VAT", ratePercent: 8, calculateOn: "BASE", order: 0, effectiveFrom: new Date(0), effectiveTo: null }] },
      },
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    expect(result.taxAmount).toBe(8);
    expect(result.serviceChargeAmount).toBe(0);
  });

  it("falls back to the default engine when useDefaultTax is false but no taxProfile is linked", () => {
    const result = resolveChargeTax({
      chargeCode: { useDefaultTax: false, taxProfile: null },
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    expect(result.taxAmount).toBe(18.7);
  });

  it("excludes a line whose effective window doesn't cover the given date", () => {
    const asOf = new Date("2026-06-01");
    const result = resolveChargeTax({
      chargeCode: {
        useDefaultTax: false,
        taxProfile: {
          rates: [
            { name: "Expired", ratePercent: 50, calculateOn: "BASE", order: 0, effectiveFrom: new Date("2025-01-01"), effectiveTo: new Date("2025-12-31") },
            { name: "Current", ratePercent: 5, calculateOn: "BASE", order: 1, effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
          ],
        },
      },
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
      asOf,
    });
    expect(result.taxAmount).toBe(5);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].name).toBe("Current");
  });
});
