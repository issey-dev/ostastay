import { describe, it, expect } from "vitest";
import { resolveOutletChargeTax } from "@/lib/tax-calc";

const settings = { serviceChargeEnabled: true, serviceChargeRate: 10, tgstEnabled: true, tgstRate: 17 };

const chargeCodeOnCustomProfile = {
  useDefaultTax: false,
  taxProfile: {
    rates: [{ name: "State Tax", ratePercent: 8, calculateOn: "BASE" as const, order: 0, effectiveFrom: new Date(0), effectiveTo: null }],
  },
};

const chargeCodeOnDefaultEngine = {
  useDefaultTax: true,
  taxProfile: null,
};

const outletCustomProfile = {
  rates: [
    { name: "Resort Fee", ratePercent: 5, calculateOn: "BASE" as const, order: 0, effectiveFrom: new Date(0), effectiveTo: null },
    { name: "Local Levy", ratePercent: 3, calculateOn: "COMPOUND" as const, order: 1, effectiveFrom: new Date(0), effectiveTo: null },
  ],
};

describe("resolveOutletChargeTax: outlet tax override precedence", () => {
  it("NONE (or no outlet) — the charge code's own tax setting applies unchanged", () => {
    const withoutOutlet = resolveOutletChargeTax({
      chargeCode: chargeCodeOnCustomProfile,
      outlet: null,
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    const withNoneOutlet = resolveOutletChargeTax({
      chargeCode: chargeCodeOnCustomProfile,
      outlet: { taxOverrideMode: "NONE", taxProfile: null },
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    // The charge code's own 8% Custom Tax profile — not Service Charge + GST.
    expect(withoutOutlet.taxAmount).toBe(8);
    expect(withoutOutlet.serviceChargeAmount).toBe(0);
    expect(withNoneOutlet).toEqual(withoutOutlet);
  });

  it("DEFAULT_ENGINE — forces Service Charge + GST even though the charge code is on a Custom profile", () => {
    const result = resolveOutletChargeTax({
      chargeCode: chargeCodeOnCustomProfile,
      outlet: { taxOverrideMode: "DEFAULT_ENGINE", taxProfile: null },
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    expect(result.serviceChargeAmount).toBe(10);
    expect(result.taxAmount).toBe(18.7);
  });

  it("CUSTOM — forces the outlet's own profile even though the charge code uses the default engine", () => {
    const result = resolveOutletChargeTax({
      chargeCode: chargeCodeOnDefaultEngine,
      outlet: { taxOverrideMode: "CUSTOM", taxProfile: outletCustomProfile },
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    expect(result.serviceChargeAmount).toBe(0);
    // Resort Fee 5% of 100 = 5; Local Levy 3% of (100 + 5) = 3.15; total = 8.15.
    expect(result.taxAmount).toBe(8.15);
  });

  it("CUSTOM overrides a charge code that's already on its own (different) Custom profile", () => {
    const result = resolveOutletChargeTax({
      chargeCode: chargeCodeOnCustomProfile, // its own profile is a flat 8%
      outlet: { taxOverrideMode: "CUSTOM", taxProfile: outletCustomProfile }, // outlet's is 5%+3% compound
      inputAmount: 100,
      settings,
      pricesIncludeTaxes: false,
    });
    expect(result.taxAmount).toBe(8.15); // the outlet's profile, not the charge code's 8
  });
});
