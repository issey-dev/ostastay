import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.SECRETS_ENCRYPTION_KEY = "test-rates-key";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { resolveRatesForLink } = await import("@/lib/channels/rates");
const { computeChannelAvailability } = await import("@/lib/channels/sync");
const { compactNights } = await import("@/lib/channels/payload");
const { formatLocalDay } = await import("@/lib/availability");

function day(offset: number): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + offset);
}
const d = (offset: number) => formatLocalDay(day(offset).getTime());

describe("Channel rates", () => {
  let enterpriseId: string;
  let propertyId: string;
  let linkId: string;
  let roomTypeId: string;
  let basePlanId: string;
  let ownPlanId: string;
  let derivedPlanId: string;

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({
      data: { name: `Rates Ent ${Date.now()}`, slug: `test-rates-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 2 } });

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Rates Property",
        code: `RA-${Date.now()}`,
        legalName: "Rates LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const connection = await prisma.channelConnection.create({
      data: { enterpriseId, provider: "BEDS24", name: `Rates Conn ${Date.now()}`, refreshToken: "x" },
    });
    linkId = (
      await prisma.channelPropertyLink.create({
        data: { connectionId: connection.id, propertyId, externalPropertyId: "ext-rates", syncEnabled: false },
      })
    ).id;

    const rt = await prisma.roomType.create({
      data: { propertyId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    roomTypeId = rt.id;
    await prisma.room.create({
      data: { propertyId, roomTypeId: rt.id, roomNumber: "301", status: "AVAILABLE" },
    });
    await prisma.channelRoomTypeMap.create({
      data: { linkId, roomTypeId: rt.id, externalRoomId: "beds-std", shared: true },
    });

    // The property's locked Base plan — the documented last-resort price source.
    basePlanId = (
      await prisma.ratePlan.create({ data: { propertyId, code: "BASE", name: "Base", isLocked: true } })
    ).id;
    // A plan with its own prices.
    ownPlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "OWN", name: "Own" } })).id;
    // A plan derived from Base at -10%.
    derivedPlanId = (
      await prisma.ratePlan.create({
        data: {
          propertyId,
          code: "DER",
          name: "Derived",
          parentRatePlanId: basePlanId,
          derivedAdjustmentType: "PERCENT",
          derivedAdjustmentValue: -10,
        },
      })
    ).id;

    for (const [planId, ext] of [
      [basePlanId, "beds-base"],
      [ownPlanId, "beds-own"],
      [derivedPlanId, "beds-der"],
    ] as const) {
      await prisma.channelRatePlanMap.create({
        data: { linkId, ratePlanId: planId, externalRateId: ext },
      });
    }

    // Base is priced on day 0 and 1; Own overrides day 0 only. Day 2 is priced nowhere.
    await prisma.priceCalendar.create({
      data: { ratePlanId: basePlanId, roomTypeId: rt.id, date: day(0), price: 200 },
    });
    await prisma.priceCalendar.create({
      data: { ratePlanId: basePlanId, roomTypeId: rt.id, date: day(1), price: 200 },
    });
    await prisma.priceCalendar.create({
      data: { ratePlanId: ownPlanId, roomTypeId: rt.id, date: day(0), price: 175 },
    });
  });

  it("uses a plan's OWN price when it has one", async () => {
    const rates = await resolveRatesForLink({ propertyId, linkId, roomTypeIds: [roomTypeId], from: day(0), to: day(1) });
    const own = rates.get(roomTypeId)!.find((r) => r.ratePlanId === ownPlanId)!;
    expect(own.prices[d(0)]).toBe(175);
  });

  it("falls back to the locked Base plan when a plan has no price of its own", async () => {
    const rates = await resolveRatesForLink({ propertyId, linkId, roomTypeIds: [roomTypeId], from: day(1), to: day(2) });
    const own = rates.get(roomTypeId)!.find((r) => r.ratePlanId === ownPlanId)!;
    // Own has no row for day 1 — it must resolve to Base's 200, exactly as the PMS would
    // charge. Publishing something different from what the desk bills is worse than
    // publishing nothing.
    expect(own.prices[d(1)]).toBe(200);
  });

  it("applies a derived plan's adjustment to its parent's price", async () => {
    const rates = await resolveRatesForLink({ propertyId, linkId, roomTypeIds: [roomTypeId], from: day(0), to: day(1) });
    const derived = rates.get(roomTypeId)!.find((r) => r.ratePlanId === derivedPlanId)!;
    // Base 200 at -10% = 180, via the app's own applyRateAdjustment.
    expect(derived.prices[d(0)]).toBe(180);
  });

  it("OMITS an unpriced night entirely — never publishes it as zero", async () => {
    const rates = await resolveRatesForLink({ propertyId, linkId, roomTypeIds: [roomTypeId], from: day(2), to: day(3) });
    const perPlan = rates.get(roomTypeId)!;

    for (const plan of perPlan) {
      // Zero is a real price meaning the rooms are free. "We don't know" and "it's free"
      // must never collapse into the same value — this is the single most damaging
      // mistake available in this file.
      expect(plan.prices[d(2)]).toBeUndefined();
      expect(Object.values(plan.prices)).not.toContain(0);
    }
  });

  it("ignores rate plans that are not mapped to the channel", async () => {
    const unmapped = await prisma.ratePlan.create({
      data: { propertyId, code: "UNM", name: "Unmapped" },
    });
    await prisma.priceCalendar.create({
      data: { ratePlanId: unmapped.id, roomTypeId, date: day(0), price: 999 },
    });

    const rates = await resolveRatesForLink({ propertyId, linkId, roomTypeIds: [roomTypeId], from: day(0), to: day(1) });
    expect(rates.get(roomTypeId)!.some((r) => r.ratePlanId === unmapped.id)).toBe(false);
    // 999 must appear nowhere — an unmapped plan has no channel rate to be sent as.
    expect(JSON.stringify([...rates.values()])).not.toContain("999");
  });

  it("keys published prices by the CHANNEL's rate id, not ours", async () => {
    const plan = await computeChannelAvailability({ enterpriseId, linkId, from: day(0), to: day(1) });
    const night = plan.roomTypes[0].nights[0];

    expect(night.prices["beds-own"]).toBe(175);
    expect(night.prices["beds-der"]).toBe(180);
    // Our internal ids must never cross the wire.
    expect(Object.keys(night.prices)).not.toContain(ownPlanId);
  });

  it("a price change SPLITS a compacted range instead of being swallowed by it", () => {
    const ranges = compactNights([
      { date: "2026-05-01", available: 2, closed: false, prices: { r1: 100 } },
      { date: "2026-05-02", available: 2, closed: false, prices: { r1: 100 } },
      { date: "2026-05-03", available: 2, closed: false, prices: { r1: 150 } },
    ]);

    // Availability is identical across all three nights. Merging on that alone would
    // publish 100 for a night that costs 150 — a silent mispricing, worse than a failure.
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toMatchObject({ from: "2026-05-01", to: "2026-05-02", prices: { r1: 100 } });
    expect(ranges[1]).toMatchObject({ from: "2026-05-03", to: "2026-05-03", prices: { r1: 150 } });
  });

  it("a night that GAINS or LOSES a rate splits the range", () => {
    const ranges = compactNights([
      { date: "2026-05-01", available: 1, closed: false, prices: { r1: 100 } },
      // Same r1 price, but r2 appears — a different instruction to the channel.
      { date: "2026-05-02", available: 1, closed: false, prices: { r1: 100, r2: 90 } },
      // r1 drops out entirely — "unpriced" is a distinct state, not a match.
      { date: "2026-05-03", available: 1, closed: false, prices: {} },
    ]);
    expect(ranges).toHaveLength(3);
    expect("prices" in ranges[2]).toBe(false);
  });

  it("omits the prices key entirely when nothing is priced", () => {
    const ranges = compactNights([{ date: "2026-05-01", available: 1, closed: false, prices: {} }]);
    // An absent key leaves whatever the channel already has; an empty object could be
    // read as an instruction to clear pricing.
    expect("prices" in ranges[0]).toBe(false);
  });
});
