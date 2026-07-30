import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: (name: string) => { cookieJar.delete(name); },
  }),
}));

const { prisma } = await import("@/lib/db");
const { computeReservationQuote } = await import("@/lib/reservation-quote-server");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// One property: a ROOM charge code (default engine: 10% Service Charge then 17% GST),
// an allocation on its own NON_REVENUE charge code with a custom flat 5% tax profile,
// Green Tax enabled at $12/adult + $6/child. Prices are tax-EXCLUSIVE
// (pricesIncludeTaxes: false) so the math is easy to hand-verify.
async function setup(opts?: { pricesIncludeTaxes?: boolean }) {
  const enterprise = await prisma.enterprise.create({
    data: { name: "Quote Test", slug: `test-quote-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `Q-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      pricesIncludeTaxes: opts?.pricesIncludeTaxes ?? false,
    },
  });
  const roomType = await prisma.roomType.create({
    data: { propertyId: property.id, name: "Standard", code: "STD", baseOccupancy: 2, maxOccupancy: 4 },
  });
  const roomCode = await customChargeCode(enterprise.id, { code: "1000", description: "Room", useDefaultTax: true, subgroupCode: "10RV" });
  const customProfile = await prisma.taxProfile.create({
    data: { enterpriseId: enterprise.id, name: "Flat 5%", rates: { create: [{ name: "Handling Fee", ratePercent: 5, calculateOn: "BASE", order: 0, effectiveFrom: new Date("2020-01-01") }] } },
  });
  const allocCode = await customChargeCode(enterprise.id, { code: "TRF", description: "Transfer", useDefaultTax: false, taxProfileId: customProfile.id, subgroupCode: "50RV" });
  const ratePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "BAR", chargeCodeId: roomCode.id } });
  const allocation = await prisma.allocation.create({
    data: {
      propertyId: property.id, code: "TRF-AIR", name: "Airport Transfer", type: "TRANSFER",
      chargeCodeId: allocCode.id, postingRhythm: "ARRIVAL_NIGHT", mode: "ADD_TO_RATE", sellSeparate: true,
      rates: { create: [{ adultPrice: 20, childPrice: 10, effectiveFrom: new Date("2020-01-01") }] },
    },
  });
  await prisma.enterpriseSettings.create({
    data: {
      enterpriseId: enterprise.id,
      serviceChargeEnabled: true, serviceChargeRate: 10,
      tgstEnabled: true, tgstRate: 17,
      greenTaxEnabled: true, greenTaxAdultAmount: 12, greenTaxChildAmount: 6,
      defaultAccommodationChargeCodeId: roomCode.id,
    },
  });
  await prisma.priceCalendar.createMany({
    data: [1, 2].map((d) => ({ ratePlanId: ratePlan.id, roomTypeId: roomType.id, date: new Date(Date.UTC(2026, 7, d)), price: 100 })),
  });

  return { propertyId: property.id, roomTypeId: roomType.id, ratePlanId: ratePlan.id, allocationId: allocation.id };
}

describe("Reservation quote engine (src/lib/reservation-quote-server.ts)", () => {
  it("computes room base + Service Charge + GST exactly like Night Audit, tax-exclusive prices", async () => {
    const ctx = await setup();
    const quote = await computeReservationQuote({
      propertyId: ctx.propertyId,
      assignments: [{ roomTypeId: ctx.roomTypeId, ratePlanId: ctx.ratePlanId, startDate: new Date("2026-08-01"), endDate: new Date("2026-08-03") }],
      adults: 2, children: 0,
    }, prisma);

    // $100/night x 2 nights = $200 base. SVC 10% = $20. GST 17% of (200+20) = $37.40.
    expect(quote.totals.roomBase).toBe(200);
    const svc = quote.taxLines.find((l) => l.name === "Service Charge")!;
    const gst = quote.taxLines.find((l) => l.name === "GST")!;
    expect(svc.amount).toBe(20);
    expect(gst.amount).toBeCloseTo(37.4, 2);
    expect(quote.totals.grandTotal).toBeCloseTo(200 + 20 + 37.4 + quote.totals.greenTaxTotal, 2);
  });

  it("attributes an allocation to its OWN charge code's custom tax profile, separate from the room's default engine", async () => {
    const ctx = await setup();
    const quote = await computeReservationQuote({
      propertyId: ctx.propertyId,
      assignments: [{ roomTypeId: ctx.roomTypeId, ratePlanId: ctx.ratePlanId, startDate: new Date("2026-08-01"), endDate: new Date("2026-08-03") }],
      adults: 2, children: 1,
      manualAllocationIds: [ctx.allocationId],
    }, prisma);

    // ARRIVAL_NIGHT only -> one night's charge: 2 adults x $20 + 1 child x $10 = $50.
    const alloc = quote.allocations.find((a) => a.allocationId === ctx.allocationId)!;
    expect(alloc.base).toBe(50);
    // Its own 5% flat "Handling Fee" line, distinct from Service Charge/GST.
    const fee = quote.taxLines.find((l) => l.name === "Handling Fee")!;
    expect(fee.amount).toBeCloseTo(2.5, 2);
    expect(alloc.tax).toBeCloseTo(2.5, 2);
    expect(alloc.breakdown.postingNights).toBe(1);
    expect(alloc.breakdown.segments[0]).toEqual({ nights: 1, adultPrice: 20, childPrice: 10, amountPerNight: 50, subtotal: 50 });
  });

  it("computes flat Green Tax per adult/child per night, unaffected by pricesIncludeTaxes", async () => {
    const ctx = await setup();
    const quote = await computeReservationQuote({
      propertyId: ctx.propertyId,
      assignments: [{ roomTypeId: ctx.roomTypeId, ratePlanId: ctx.ratePlanId, startDate: new Date("2026-08-01"), endDate: new Date("2026-08-03") }],
      adults: 2, children: 1,
    }, prisma);
    // (2 x $12 + 1 x $6) x 2 nights = $60.
    expect(quote.greenTax.total).toBe(60);
    expect(quote.totals.greenTaxTotal).toBe(60);
  });

  it("backs tax out of an inclusive price when pricesIncludeTaxes is true, reconstructing the same gross", async () => {
    const ctx = await setup({ pricesIncludeTaxes: true });
    const quote = await computeReservationQuote({
      propertyId: ctx.propertyId,
      assignments: [{ roomTypeId: ctx.roomTypeId, ratePlanId: ctx.ratePlanId, startDate: new Date("2026-08-01"), endDate: new Date("2026-08-03") }],
      adults: 1, children: 0,
    }, prisma);
    // base + tax + service charge must reconstruct the original $100/night x 2 = $200 gross.
    const taxTotal = quote.taxLines.reduce((s, l) => s + l.amount, 0);
    expect(quote.totals.roomBase + taxTotal).toBeCloseTo(200, 2);
    expect(quote.pricesIncludeTaxes).toBe(true);
  });

  it("a flat override rate replaces the calendar price entirely", async () => {
    const ctx = await setup();
    const quote = await computeReservationQuote({
      propertyId: ctx.propertyId,
      assignments: [{ roomTypeId: ctx.roomTypeId, ratePlanId: ctx.ratePlanId, startDate: new Date("2026-08-01"), endDate: new Date("2026-08-03"), overrideRate: 50 }],
      adults: 1, children: 0,
    }, prisma);
    expect(quote.totals.roomBase).toBe(100); // $50 x 2 nights, not $100 x 2
  });

  it("prices off chargeRoomTypeId (kept rate on a room move) while the day grid shows the physical room type", async () => {
    const ctx = await setup();
    // A second, pricier room type with its own calendar rows for the same nights.
    const deluxe = await prisma.roomType.create({
      data: { propertyId: ctx.propertyId, name: "Deluxe", code: `DLX-${uniq()}`, baseOccupancy: 2, maxOccupancy: 4 },
    });
    await prisma.priceCalendar.createMany({
      data: [1, 2].map((d) => ({ ratePlanId: ctx.ratePlanId, roomTypeId: deluxe.id, date: new Date(Date.UTC(2026, 7, d)), price: 250 })),
    });

    const quote = await computeReservationQuote({
      propertyId: ctx.propertyId,
      // Physically in the Deluxe room, but billed AS the Standard type (rate kept).
      assignments: [{
        roomTypeId: deluxe.id,
        chargeRoomTypeId: ctx.roomTypeId,
        ratePlanId: ctx.ratePlanId,
        startDate: new Date("2026-08-01"), endDate: new Date("2026-08-03"),
      }],
      adults: 2, children: 0,
    }, prisma);

    // Standard $100/night x 2 = $200, NOT Deluxe's $250 x 2 = $500.
    expect(quote.totals.roomBase).toBe(200);
    // The per-night grid still reports the physical room type the guest occupies.
    expect(quote.days[0].roomTypeId).toBe(deluxe.id);
  });

  it("flags nights with no configured rate as unpriced instead of silently charging $0 unnoticed", async () => {
    const ctx = await setup();
    const quote = await computeReservationQuote({
      propertyId: ctx.propertyId,
      // Aug 3-4 has no PriceCalendar rows at all (only 1st and 2nd were seeded).
      assignments: [{ roomTypeId: ctx.roomTypeId, ratePlanId: ctx.ratePlanId, startDate: new Date("2026-08-03"), endDate: new Date("2026-08-04") }],
      adults: 1, children: 0,
    }, prisma);
    expect(quote.segments[0].unpricedNights).toBe(1);
    expect(quote.segments[0].roomBase).toBe(0);
    expect(quote.warnings.some((w) => w.includes("no configured rate"))).toBe(true);
  });
});
