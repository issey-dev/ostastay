import { describe, it, expect } from "vitest";
import { selectRate, rateAmount, taxOverrideFor, type RateLike } from "@/lib/transport/pricing";
import { attentionFor, capacityState } from "@/lib/transport/attention";
import { localToUtc, utcToLocal, tzOffsetMinutes, addDaysKey } from "@/lib/transport/time";
import { resolveOutletChargeTax } from "@/lib/tax-calc";

// Pure rules of the Transportation module (TRANSPORTATION_PLAN.md): rate selection and
// amounts, tax mode → posting engine, attention warnings, and property-time-zone handling.

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const rate = (r: Partial<RateLike> & { id: string }): RateLike => ({
  routeId: "R1",
  transportTypeId: null,
  providerId: null,
  direction: "BOTH",
  pricingBasis: "PER_PERSON",
  price: 0,
  adultPrice: 100,
  childPrice: 50,
  infantPrice: 0,
  validFrom: null,
  validTo: null,
  isActive: true,
  ...r,
});

describe("transport pricing", () => {
  const q = { routeId: "R1", direction: "PICKUP", serviceDate: D("2026-12-20") };

  it("returns null (complimentary) when a route has no applicable rate", () => {
    expect(selectRate([], q)).toBeNull();
    expect(selectRate([rate({ id: "x", isActive: false })], q)).toBeNull();
    expect(selectRate([rate({ id: "x", direction: "DROP_OFF" })], q)).toBeNull();
    expect(selectRate([rate({ id: "x", routeId: "R2" })], q)).toBeNull();
  });

  it("respects validity dates", () => {
    const old = rate({ id: "old", validTo: D("2026-10-31") });
    const peak = rate({ id: "peak", validFrom: D("2026-12-15"), validTo: D("2027-01-10") });
    expect(selectRate([old, peak], q)?.id).toBe("peak");
    expect(selectRate([old, peak], { ...q, serviceDate: D("2026-10-31") })?.id).toBe("old");
    expect(selectRate([old, peak], { ...q, serviceDate: D("2026-11-20") })).toBeNull();
  });

  it("prefers the most specific rate: provider, then transport type, then exact direction, then the newest season", () => {
    const base = rate({ id: "base" });
    const pickup = rate({ id: "pickup", direction: "PICKUP" });
    const seaplane = rate({ id: "type", transportTypeId: "SPL" });
    const operator = rate({ id: "provider", providerId: "P1" });
    const season = rate({ id: "season", validFrom: D("2026-12-01") });
    expect(selectRate([base, pickup], q)?.id).toBe("pickup");
    expect(selectRate([base, pickup, seaplane], { ...q, transportTypeId: "SPL" })?.id).toBe("type");
    expect(selectRate([base, seaplane, operator], { ...q, transportTypeId: "SPL", providerId: "P1" })?.id).toBe("provider");
    // A provider's own rate never prices someone else's boat.
    expect(selectRate([operator], { ...q, providerId: "P2" })).toBeNull();
    expect(selectRate([base, season], q)?.id).toBe("season");
  });

  it("computes per person, per vehicle and per trip amounts", () => {
    const party = { adults: 2, children: 1, infants: 1 };
    expect(rateAmount(rate({ id: "a", adultPrice: 120, childPrice: 60, infantPrice: 10 }), party)).toBe(310);
    expect(rateAmount(rate({ id: "v", pricingBasis: "PER_VEHICLE", price: 90 }), party, 2)).toBe(180);
    expect(rateAmount(rate({ id: "v0", pricingBasis: "PER_VEHICLE", price: 90 }), party, 0)).toBe(90);
    expect(rateAmount(rate({ id: "t", pricingBasis: "PER_TRIP", price: 250 }), party, 3)).toBe(250);
  });

  it("maps a rate's tax mode onto the posting engine's tax override", () => {
    const settings = { serviceChargeEnabled: true, serviceChargeRate: 10, tgstEnabled: true, tgstRate: 17 };
    const noTaxCode = { useDefaultTax: false, taxProfile: { rates: [] } };
    // CHARGE_CODE: the code's own (here: none).
    const asCode = resolveOutletChargeTax({ chargeCode: noTaxCode, outlet: taxOverrideFor("CHARGE_CODE", null), inputAmount: 100, settings, pricesIncludeTaxes: false });
    expect(asCode.baseAmount + asCode.taxAmount + asCode.serviceChargeAmount).toBe(100);
    // DEFAULT: Service Charge 10% then GST 17% on top → 128.70.
    const def = resolveOutletChargeTax({ chargeCode: noTaxCode, outlet: taxOverrideFor("DEFAULT", null), inputAmount: 100, settings, pricesIncludeTaxes: false });
    expect(Math.round((def.baseAmount + def.taxAmount + def.serviceChargeAmount) * 100) / 100).toBe(128.7);
    // CUSTOM: the chosen profile only.
    const profile = { rates: [{ name: "Tourism tax", ratePercent: 5, calculateOn: "BASE", order: 0, effectiveFrom: D("2020-01-01"), effectiveTo: null }] };
    const custom = resolveOutletChargeTax({ chargeCode: noTaxCode, outlet: taxOverrideFor("CUSTOM", profile), inputAmount: 100, settings, pricesIncludeTaxes: false });
    expect(custom.taxAmount).toBe(5);
    expect(taxOverrideFor("CUSTOM", null)).toBeNull();
  });
});

describe("transport attention rules", () => {
  const at = (hhmm: string) => new Date(`2026-12-20T${hhmm}:00.000Z`);
  const base = {
    status: "CONFIRMED",
    flightNo: "EK652",
    durationMinutes: 45,
    toleranceMinutes: 60,
    onManifest: false,
    flightAtOnManifest: null,
    needsFlight: true,
  };

  it("flags a pickup leaving too soon after (or before) landing", () => {
    expect(attentionFor({ ...base, direction: "PICKUP", flightAt: at("09:00"), departureAt: at("10:00") })).toEqual([]);
    expect(attentionFor({ ...base, direction: "PICKUP", flightAt: at("09:30"), departureAt: at("10:00") }).map((a) => a.code)).toEqual(["TOO_SOON_AFTER_LANDING"]);
    expect(attentionFor({ ...base, direction: "PICKUP", flightAt: at("11:00"), departureAt: at("10:00") })[0].message).toMatch(/before the flight lands/);
  });

  it("flags a drop-off reaching the airport too close to take-off, counting the route's duration", () => {
    // Leaves 12:00, 45 min crossing → airport 12:45; flight 14:00 → 75 min: fine.
    expect(attentionFor({ ...base, direction: "DROP_OFF", flightAt: at("14:00"), departureAt: at("12:00") })).toEqual([]);
    // Flight 13:30 → 45 min at the airport: needs attention.
    expect(attentionFor({ ...base, direction: "DROP_OFF", flightAt: at("13:30"), departureAt: at("12:00") }).map((a) => a.code)).toEqual(["TOO_CLOSE_TO_FLIGHT"]);
  });

  it("flags a flight time that changed after the booking joined its departure", () => {
    const r = attentionFor({ ...base, direction: "PICKUP", flightAt: at("07:00"), departureAt: at("10:00"), onManifest: true, flightAtOnManifest: at("08:00") });
    expect(r.map((a) => a.code)).toEqual(["FLIGHT_CHANGED"]);
  });

  it("flags missing flight details on a confirmed airport transfer only", () => {
    expect(attentionFor({ ...base, direction: "PICKUP", flightNo: null, flightAt: null, departureAt: at("10:00") }).map((a) => a.code)).toEqual(["FLIGHT_MISSING"]);
    expect(attentionFor({ ...base, status: "DRAFT", direction: "PICKUP", flightNo: null, flightAt: null, departureAt: at("10:00") })).toEqual([]);
    expect(attentionFor({ ...base, needsFlight: false, direction: "PICKUP", flightNo: null, flightAt: null, departureAt: at("10:00") })).toEqual([]);
  });

  it("flags a live transfer whose reservation was cancelled or never arrived", () => {
    const r = attentionFor({ ...base, direction: "PICKUP", flightAt: at("08:00"), departureAt: at("10:00"), reservationStatus: "CANCELLED" });
    expect(r.map((a) => a.code)).toEqual(["RESERVATION_CLOSED"]);
    expect(attentionFor({ ...base, status: "CANCELLED", direction: "PICKUP", flightAt: null, departureAt: null, reservationStatus: "CANCELLED" })).toEqual([]);
  });

  it("never warns about finished bookings", () => {
    for (const status of ["COMPLETED", "NO_SHOW", "CANCELLED"]) {
      expect(attentionFor({ ...base, status, direction: "PICKUP", flightAt: at("09:50"), departureAt: at("10:00") })).toEqual([]);
    }
  });

  it("capacity is a soft state", () => {
    expect(capacityState(3, 4)).toBe("OK");
    expect(capacityState(4, 4)).toBe("FULL");
    expect(capacityState(5, 4)).toBe("OVER");
    expect(capacityState(5, null)).toBe("UNKNOWN");
  });
});

describe("transport time zones", () => {
  it("stores Maldives local times as UTC and reads them back", () => {
    expect(tzOffsetMinutes(new Date(), "Indian/Maldives")).toBe(300);
    const utc = localToUtc("2026-12-20", "09:30", "Indian/Maldives");
    expect(utc.toISOString()).toBe("2026-12-20T04:30:00.000Z");
    expect(utcToLocal(utc, "Indian/Maldives")).toEqual({ dateKey: "2026-12-20", time: "09:30" });
    // Just after local midnight is still the local day, though UTC is the day before.
    const early = localToUtc("2026-12-20", "02:00", "Indian/Maldives");
    expect(early.toISOString().slice(0, 10)).toBe("2026-12-19");
    expect(utcToLocal(early, "Indian/Maldives").dateKey).toBe("2026-12-20");
  });

  it("handles a zone with daylight saving", () => {
    const summer = localToUtc("2026-07-01", "12:00", "Europe/London");
    expect(summer.toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(utcToLocal(summer, "Europe/London").time).toBe("12:00");
  });

  it("adds days across month ends", () => {
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2027-03-01", -1)).toBe("2027-02-28");
  });
});
