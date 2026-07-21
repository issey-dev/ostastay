import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/scope.test.ts.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { validateRateRanges, resolveLinkedAllocationIds, allocationAmountForNight, isPostingNight, allocationStayBreakdown } =
  await import("@/lib/allocations");
const { materializeReservationAllocations } = await import("@/lib/allocations-server");

const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const DAY = 86400000;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// Builds a checked-in reservation under a fresh enterprise with a ROOM charge code and
// an Admin user, plus an allocation (with its own charge code + rate row) attached via
// ReservationAllocation. Green Tax stays disabled (no EnterpriseSettings row) so folio
// assertions only see room + allocation lines.
async function setupWithAllocation(opts: {
  slug: string;
  adults: number;
  children: number;
  infants?: number;
  checkInOffsetDays: number; // relative to today, e.g. -1 = yesterday
  checkOutOffsetDays: number;
  allocation: {
    mode: string;
    postingRhythm: string;
    adultPrice: number;
    childPrice: number;
    rateFromOffsetDays?: number; // default -30
    rateToOffsetDays?: number | null; // default null (open-ended)
  };
  overrideAdultPrice?: number | null;
  overrideChildPrice?: number | null;
}) {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

  const enterprise = await prisma.enterprise.create({
    data: { name: opts.slug, slug: `${opts.slug}-${uniq()}`, type: "STANDARD" },
  });

  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: `${opts.slug}-property`, code: `AL-${uniq()}`,
      legalName: "Allocations Test LLC", defaultCurrency: "USD", timeZone: "UTC",
      checkInTime: "14:00", checkOutTime: "11:00",
    },
  });

  const roomType = await prisma.roomType.create({
    data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 6 },
  });
  const room = await prisma.room.create({
    data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `1${Math.floor(Math.random() * 900 + 100)}` },
  });
  const ratePlan = await prisma.ratePlan.create({
    data: { propertyId: property.id, code: "STD", name: "Standard Rate" },
  });

  const roomCode = await prisma.chargeCode.create({
    data: { enterpriseId: enterprise.id, code: "ROOM", description: "Room" },
  });
  const allocCode = await prisma.chargeCode.create({
    data: { enterpriseId: enterprise.id, code: "BFC", description: "Breakfast Revenue", category: "FOOD_BEVERAGE" },
  });

  const today = new Date();
  const allocation = await prisma.allocation.create({
    data: {
      propertyId: property.id,
      code: "BF",
      name: "Breakfast",
      type: "FNB",
      chargeCodeId: allocCode.id,
      postingRhythm: opts.allocation.postingRhythm,
      mode: opts.allocation.mode,
      rates: {
        create: {
          adultPrice: opts.allocation.adultPrice,
          childPrice: opts.allocation.childPrice,
          effectiveFrom: new Date(today.getTime() + (opts.allocation.rateFromOffsetDays ?? -30) * DAY),
          effectiveTo:
            opts.allocation.rateToOffsetDays === undefined || opts.allocation.rateToOffsetDays === null
              ? null
              : new Date(today.getTime() + opts.allocation.rateToOffsetDays * DAY),
        },
      },
    },
  });

  const guest = await prisma.profile.create({
    data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Alloc", lastName: "Guest" },
  });

  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      confirmationNo: `AL-${uniq()}`,
      primaryGuestId: guest.upid,
      checkInDate: new Date(today.getTime() + opts.checkInOffsetDays * DAY),
      checkOutDate: new Date(today.getTime() + opts.checkOutOffsetDays * DAY),
      status: "IN_HOUSE",
      adults: opts.adults,
      children: opts.children,
      infants: opts.infants ?? 0,
      assignments: {
        create: {
          roomTypeId: roomType.id,
          roomId: room.id,
          ratePlanId: ratePlan.id,
          overrideRate: 100,
          startDate: new Date(today.getTime() + opts.checkInOffsetDays * DAY),
          endDate: new Date(today.getTime() + opts.checkOutOffsetDays * DAY),
        },
      },
      folios: { create: { folioNumber: 1, propertyId: property.id } },
      allocations: {
        create: {
          allocationId: allocation.id,
          source: "MANUAL",
          overrideAdultPrice: opts.overrideAdultPrice ?? null,
          overrideChildPrice: opts.overrideChildPrice ?? null,
        },
      },
    },
    include: { folios: true },
  });

  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `al-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "AL", roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });

  return {
    enterpriseId: enterprise.id,
    propertyId: property.id,
    folioId: reservation.folios[0].id,
    reservationId: reservation.id,
    ratePlanId: ratePlan.id,
    allocationId: allocation.id,
    adminId: admin.id,
  };
}

async function runNightAudit(adminId: string, propertyId: string) {
  const res = await asUser(adminId, () =>
    nightAuditRunRoute.POST(
      new Request("http://localhost/api/night-audit/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId }),
      })
    )
  );
  expect(res.status).toBe(200);
}

async function folioLines(folioId: string) {
  return prisma.folioLineItem.findMany({ where: { folioId }, include: { chargeCode: true } });
}

describe("Allocations: pure helpers", () => {
  it("validateRateRanges rejects overlapping ranges and end-before-start", () => {
    const d = (s: string) => new Date(s);
    expect(
      validateRateRanges([
        { effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-06-30") },
        { effectiveFrom: d("2026-07-01"), effectiveTo: null },
      ])
    ).toBeNull();
    expect(
      validateRateRanges([
        { effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-07-01") },
        { effectiveFrom: d("2026-07-01"), effectiveTo: null },
      ])
    ).toMatch(/overlap/);
    // Open-ended range followed by a later range = overlap.
    expect(
      validateRateRanges([
        { effectiveFrom: d("2026-01-01"), effectiveTo: null },
        { effectiveFrom: d("2026-07-01"), effectiveTo: null },
      ])
    ).toMatch(/overlap/);
    expect(
      validateRateRanges([{ effectiveFrom: d("2026-07-01"), effectiveTo: d("2026-01-01") }])
    ).toMatch(/before its start/);
  });

  it("isPostingNight gates arrival/departure/every-night correctly", () => {
    const checkIn = new Date("2026-07-10T14:00:00");
    const checkOut = new Date("2026-07-13T11:00:00");
    // Arrival night = the 10th only.
    expect(isPostingNight("ARRIVAL_NIGHT", checkIn, checkOut, new Date("2026-07-10T23:00:00"))).toBe(true);
    expect(isPostingNight("ARRIVAL_NIGHT", checkIn, checkOut, new Date("2026-07-11T23:00:00"))).toBe(false);
    // Departure night = the LAST night (12th, since checkout is the 13th).
    expect(isPostingNight("DEPARTURE_NIGHT", checkIn, checkOut, new Date("2026-07-12T23:00:00"))).toBe(true);
    expect(isPostingNight("DEPARTURE_NIGHT", checkIn, checkOut, new Date("2026-07-13T23:00:00"))).toBe(false);
    expect(isPostingNight("EVERY_NIGHT", checkIn, checkOut, new Date("2026-07-11T23:00:00"))).toBe(true);
  });

  it("allocationAmountForNight charges adults+children only and honours overrides and date ranges", () => {
    const base = {
      id: "x", code: "BF", name: "Breakfast", mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT",
      rates: [
        { adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30") },
        { adultPrice: 12, childPrice: 6, effectiveFrom: new Date("2026-07-01"), effectiveTo: null },
      ],
    };
    const stay = { checkInDate: new Date("2026-07-10"), checkOutDate: new Date("2026-07-12") };
    // July rate row applies; infants aren't even a parameter.
    expect(
      allocationAmountForNight({ allocation: base, adults: 2, children: 1, auditDate: new Date("2026-07-10"), ...stay })
    ).toBe(2 * 12 + 1 * 6);
    // January date uses the older row.
    expect(
      allocationAmountForNight({
        allocation: base, adults: 2, children: 1, auditDate: new Date("2026-03-15"),
        checkInDate: new Date("2026-03-14"), checkOutDate: new Date("2026-03-16"),
      })
    ).toBe(2 * 10 + 1 * 5);
    // A date before any range → null (posts nothing).
    expect(
      allocationAmountForNight({
        allocation: base, adults: 2, children: 1, auditDate: new Date("2025-12-01"),
        checkInDate: new Date("2025-11-30"), checkOutDate: new Date("2025-12-02"),
      })
    ).toBeNull();
    // Negotiated per-reservation overrides replace the range's prices.
    expect(
      allocationAmountForNight({
        allocation: base, adults: 2, children: 1, auditDate: new Date("2026-07-10"), ...stay,
        overrideAdultPrice: 8, overrideChildPrice: 4,
      })
    ).toBe(2 * 8 + 1 * 4);
  });

  it("resolveLinkedAllocationIds in RATE_PLAN mode inherits parent links for derived plans and ignores meal-plan links entirely", () => {
    // Derived plan with no links of its own → parent's links, tagged RATE_PLAN.
    // mealPlanLinks is present in the input but must be completely ignored in this mode.
    expect(
      resolveLinkedAllocationIds({
        mode: "RATE_PLAN",
        ratePlanLinks: [],
        parentRatePlanLinks: [{ allocationId: "bf" }],
        mealPlanLinks: [{ allocationId: "bf" }, { allocationId: "dn" }],
      })
    ).toEqual([{ allocationId: "bf", source: "RATE_PLAN" }]);
    // Own links replace the parent's.
    expect(
      resolveLinkedAllocationIds({
        mode: "RATE_PLAN",
        ratePlanLinks: [{ allocationId: "spa" }],
        parentRatePlanLinks: [{ allocationId: "bf" }],
        mealPlanLinks: [],
      })
    ).toEqual([{ allocationId: "spa", source: "RATE_PLAN" }]);
  });

  it("resolveLinkedAllocationIds in MEAL_PLAN mode uses only meal-plan links, ignoring the rate plan's entirely", () => {
    expect(
      resolveLinkedAllocationIds({
        mode: "MEAL_PLAN",
        ratePlanLinks: [{ allocationId: "spa" }],
        parentRatePlanLinks: [{ allocationId: "bf" }],
        mealPlanLinks: [{ allocationId: "dn" }],
      })
    ).toEqual([{ allocationId: "dn", source: "MEAL_PLAN" }]);
    // No meal plan selected → nothing attaches, even though the rate plan has links.
    expect(
      resolveLinkedAllocationIds({
        mode: "MEAL_PLAN",
        ratePlanLinks: [{ allocationId: "spa" }],
        parentRatePlanLinks: [],
        mealPlanLinks: [],
      })
    ).toEqual([]);
  });

  it("allocationStayBreakdown groups nights sharing a unit price into one segment, per booking-summary display", () => {
    const base = {
      id: "x", code: "BF", name: "Breakfast", mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT",
      rates: [{ adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }],
    };
    const result = allocationStayBreakdown({
      allocation: base, adults: 2, children: 1,
      checkInDate: new Date("2026-07-10"), checkOutDate: new Date("2026-07-13"),
    });
    expect(result.totalNights).toBe(3);
    expect(result.postingNights).toBe(3);
    expect(result.unpricedNights).toBe(0);
    expect(result.segments).toEqual([
      { nights: 3, adultPrice: 10, childPrice: 5, amountPerNight: 25, subtotal: 75 },
    ]);
    expect(result.total).toBe(75);
  });

  it("allocationStayBreakdown splits into multiple segments when the rate changes mid-stay", () => {
    const base = {
      id: "x", code: "BF", name: "Breakfast", mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT",
      rates: [
        { adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2026-07-01"), effectiveTo: new Date("2026-07-11") },
        { adultPrice: 15, childPrice: 7, effectiveFrom: new Date("2026-07-12"), effectiveTo: null },
      ],
    };
    const result = allocationStayBreakdown({
      allocation: base, adults: 1, children: 0,
      checkInDate: new Date("2026-07-10"), checkOutDate: new Date("2026-07-13"),
    });
    // Nights: 10 (rate A), 11 (rate A), 12 (rate B) — two segments.
    expect(result.segments).toEqual([
      { nights: 2, adultPrice: 10, childPrice: 5, amountPerNight: 10, subtotal: 20 },
      { nights: 1, adultPrice: 15, childPrice: 7, amountPerNight: 15, subtotal: 15 },
    ]);
    expect(result.total).toBe(35);
  });

  it("allocationStayBreakdown honors postingRhythm (arrival/departure-only) and reports unpriced nights separately", () => {
    const arrivalOnly = {
      id: "x", code: "TRF", name: "Transfer", mode: "ADD_TO_RATE", postingRhythm: "ARRIVAL_NIGHT",
      rates: [{ adultPrice: 20, childPrice: 10, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }],
    };
    const result = allocationStayBreakdown({
      allocation: arrivalOnly, adults: 2, children: 0,
      checkInDate: new Date("2026-07-10"), checkOutDate: new Date("2026-07-13"),
    });
    expect(result.postingNights).toBe(1);
    expect(result.segments).toEqual([{ nights: 1, adultPrice: 20, childPrice: 10, amountPerNight: 40, subtotal: 40 }]);
    expect(result.total).toBe(40);

    // A rhythm-qualifying night with no rate range covering it is counted as unpriced,
    // not silently folded into a $0 segment.
    const noRateYet = {
      id: "y", code: "BF", name: "Breakfast", mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT",
      rates: [{ adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2026-08-01"), effectiveTo: null }],
    };
    const result2 = allocationStayBreakdown({
      allocation: noRateYet, adults: 1, children: 0,
      checkInDate: new Date("2026-07-10"), checkOutDate: new Date("2026-07-13"),
    });
    expect(result2.postingNights).toBe(0);
    expect(result2.unpricedNights).toBe(3);
    expect(result2.segments).toEqual([]);
    expect(result2.total).toBe(0);
  });
});

describe("Allocations: Night Audit posting", () => {
  it("EVERY_NIGHT + ADD_TO_RATE posts pax math to the allocation's own charge code on top of the room line", async () => {
    const { propertyId, folioId, adminId } = await setupWithAllocation({
      slug: "test-alloc-addtorate",
      adults: 2, children: 1, infants: 1,
      checkInOffsetDays: -1, checkOutOffsetDays: 2,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT", adultPrice: 10, childPrice: 5 },
    });

    await runNightAudit(adminId, propertyId);
    const lines = await folioLines(folioId);

    const bf = lines.find((l) => l.chargeCode.code === "BFC");
    expect(bf).toBeDefined();
    // 2 adults * $10 + 1 child * $5 = $25; the infant contributes nothing.
    expect(bf!.amount).toBe(25);
    expect(bf!.description).toContain("Breakfast");

    // Room line unchanged by an additive allocation (no settings row → no tax backing-out).
    const roomLine = lines.find((l) => l.chargeCode.code === "ROOM" && l.description === "Nightly Room Charge");
    expect(roomLine!.amount).toBe(100);
  });

  it("INCLUDE_IN_RATE carves the allocation out of the room line (folio total unchanged)", async () => {
    const { propertyId, folioId, adminId } = await setupWithAllocation({
      slug: "test-alloc-include",
      adults: 2, children: 1,
      checkInOffsetDays: -1, checkOutOffsetDays: 2,
      allocation: { mode: "INCLUDE_IN_RATE", postingRhythm: "EVERY_NIGHT", adultPrice: 10, childPrice: 5 },
    });

    await runNightAudit(adminId, propertyId);
    const lines = await folioLines(folioId);

    const bf = lines.find((l) => l.chargeCode.code === "BFC");
    const roomLine = lines.find((l) => l.chargeCode.code === "ROOM" && l.description === "Nightly Room Charge");
    expect(bf!.amount).toBe(25);
    expect(roomLine!.amount).toBe(75); // 100 − 25 carve-out
    // Attribution moved, total preserved.
    expect(bf!.amount + roomLine!.amount).toBe(100);
  });

  it("INCLUDE_IN_RATE clamps the room line at zero when the allocation exceeds the rate", async () => {
    const { propertyId, folioId, adminId } = await setupWithAllocation({
      slug: "test-alloc-clamp",
      adults: 10, children: 5,
      checkInOffsetDays: -1, checkOutOffsetDays: 2,
      allocation: { mode: "INCLUDE_IN_RATE", postingRhythm: "EVERY_NIGHT", adultPrice: 20, childPrice: 10 },
    });

    await runNightAudit(adminId, propertyId);
    const lines = await folioLines(folioId);

    const bf = lines.find((l) => l.chargeCode.code === "BFC");
    const roomLine = lines.find((l) => l.chargeCode.code === "ROOM" && l.description === "Nightly Room Charge");
    expect(bf!.amount).toBe(10 * 20 + 5 * 10); // 250 — posts in full
    expect(roomLine!.amount).toBe(0); // clamped, never negative
  });

  it("ARRIVAL_NIGHT posts only on the check-in night", async () => {
    // Checked in TODAY → arrival night is tonight → posts.
    const arriving = await setupWithAllocation({
      slug: "test-alloc-arrival-yes",
      adults: 1, children: 0,
      checkInOffsetDays: 0, checkOutOffsetDays: 3,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "ARRIVAL_NIGHT", adultPrice: 50, childPrice: 0 },
    });
    await runNightAudit(arriving.adminId, arriving.propertyId);
    expect((await folioLines(arriving.folioId)).some((l) => l.chargeCode.code === "BFC")).toBe(true);

    // Checked in YESTERDAY → tonight is not the arrival night → nothing posts.
    const midStay = await setupWithAllocation({
      slug: "test-alloc-arrival-no",
      adults: 1, children: 0,
      checkInOffsetDays: -1, checkOutOffsetDays: 3,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "ARRIVAL_NIGHT", adultPrice: 50, childPrice: 0 },
    });
    await runNightAudit(midStay.adminId, midStay.propertyId);
    expect((await folioLines(midStay.folioId)).some((l) => l.chargeCode.code === "BFC")).toBe(false);
  });

  it("DEPARTURE_NIGHT posts only on the stay's last night", async () => {
    // Checkout TOMORROW → tonight is the last night → posts.
    const lastNight = await setupWithAllocation({
      slug: "test-alloc-departure-yes",
      adults: 1, children: 0,
      checkInOffsetDays: -2, checkOutOffsetDays: 1,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "DEPARTURE_NIGHT", adultPrice: 40, childPrice: 0 },
    });
    await runNightAudit(lastNight.adminId, lastNight.propertyId);
    expect((await folioLines(lastNight.folioId)).some((l) => l.chargeCode.code === "BFC")).toBe(true);

    // Checkout in 3 days → not the last night → nothing posts.
    const midStay = await setupWithAllocation({
      slug: "test-alloc-departure-no",
      adults: 1, children: 0,
      checkInOffsetDays: -1, checkOutOffsetDays: 3,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "DEPARTURE_NIGHT", adultPrice: 40, childPrice: 0 },
    });
    await runNightAudit(midStay.adminId, midStay.propertyId);
    expect((await folioLines(midStay.folioId)).some((l) => l.chargeCode.code === "BFC")).toBe(false);
  });

  it("posts nothing when no rate range covers the audit date", async () => {
    const { propertyId, folioId, adminId } = await setupWithAllocation({
      slug: "test-alloc-norange",
      adults: 2, children: 0,
      checkInOffsetDays: -1, checkOutOffsetDays: 2,
      // Range ended 10 days ago; nothing covers today.
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT", adultPrice: 10, childPrice: 5, rateFromOffsetDays: -30, rateToOffsetDays: -10 },
    });
    await runNightAudit(adminId, propertyId);
    expect((await folioLines(folioId)).some((l) => l.chargeCode.code === "BFC")).toBe(false);
  });

  it("honours per-reservation negotiated price overrides", async () => {
    const { propertyId, folioId, adminId } = await setupWithAllocation({
      slug: "test-alloc-override",
      adults: 2, children: 2,
      checkInOffsetDays: -1, checkOutOffsetDays: 2,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT", adultPrice: 10, childPrice: 5 },
      overrideAdultPrice: 7,
      overrideChildPrice: 3,
    });
    await runNightAudit(adminId, propertyId);
    const bf = (await folioLines(folioId)).find((l) => l.chargeCode.code === "BFC");
    expect(bf!.amount).toBe(2 * 7 + 2 * 3);
  });
});

describe("Allocations: reservation materialization", () => {
  it("RATE_PLAN mode (the default) attaches only rate-plan-linked allocations, ignoring the meal plan entirely; MANUAL rows survive re-materialization", async () => {
    const { propertyId, reservationId, ratePlanId, allocationId, enterpriseId } = await setupWithAllocation({
      slug: "test-alloc-materialize",
      adults: 2, children: 0,
      checkInOffsetDays: 1, checkOutOffsetDays: 4,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT", adultPrice: 10, childPrice: 5 },
    });

    // Confirm the property defaults to RATE_PLAN mode without anything setting it explicitly.
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(property!.allocationCalculationMode).toBe("RATE_PLAN");

    // A second allocation linked to the rate plan, and a third linked to a meal plan.
    const cc = await prisma.chargeCode.create({
      data: { enterpriseId, code: "TRF", description: "Transfers", category: "TRANSPORTATION" },
    });
    const transfer = await prisma.allocation.create({
      data: {
        propertyId, code: "TRF-SB", name: "Speedboat Transfer", type: "TRANSFER",
        chargeCodeId: cc.id, postingRhythm: "ARRIVAL_NIGHT", mode: "ADD_TO_RATE",
        rates: { create: { adultPrice: 100, childPrice: 50, effectiveFrom: new Date("2020-01-01") } },
      },
    });
    await prisma.ratePlanAllocation.create({ data: { ratePlanId, allocationId: transfer.id } });

    const dinner = await prisma.allocation.create({
      data: {
        propertyId, code: "DN", name: "Dinner", type: "FNB",
        chargeCodeId: cc.id, postingRhythm: "EVERY_NIGHT", mode: "ADD_TO_RATE",
        rates: { create: { adultPrice: 30, childPrice: 15, effectiveFrom: new Date("2020-01-01") } },
      },
    });
    const mealPlan = await prisma.mealPlan.create({
      data: { propertyId, code: "HB", name: "Half Board", allocationLinks: { create: { allocationId: dinner.id } } },
    });

    // Materialize in RATE_PLAN mode with mealPlanCode "HB" set: only the rate plan's
    // own link (transfer) attaches — dinner (meal-plan-linked) must NOT attach even
    // though a meal plan is selected. The existing MANUAL BF row (from setup) must
    // survive untouched.
    const result = await materializeReservationAllocations({
      reservationId, propertyId, ratePlanId, mealPlanCode: "HB",
    });
    expect(result.error).toBeUndefined();

    let rows = await prisma.reservationAllocation.findMany({ where: { reservationId } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.allocationId === transfer.id)?.source).toBe("RATE_PLAN");
    expect(rows.some((r) => r.allocationId === dinner.id)).toBe(false);
    expect(rows.find((r) => r.allocationId === allocationId)?.source).toBe("MANUAL");

    // Explicitly clearing the manual set removes the manual row too; transfer stays
    // (still rate-plan-linked).
    await materializeReservationAllocations({
      reservationId, propertyId, ratePlanId, mealPlanCode: "HB", manualAllocationIds: [],
    });
    rows = await prisma.reservationAllocation.findMany({ where: { reservationId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].allocationId).toBe(transfer.id);
    expect(mealPlan.id).toBeDefined();
  });

  it("MEAL_PLAN mode attaches only the selected meal plan's linked allocations, ignoring the rate plan's own links entirely", async () => {
    const { propertyId, reservationId, ratePlanId, enterpriseId } = await setupWithAllocation({
      slug: "test-alloc-materialize-mp",
      adults: 2, children: 0,
      checkInOffsetDays: 1, checkOutOffsetDays: 4,
      allocation: { mode: "ADD_TO_RATE", postingRhythm: "EVERY_NIGHT", adultPrice: 10, childPrice: 5 },
    });
    await prisma.property.update({ where: { id: propertyId }, data: { allocationCalculationMode: "MEAL_PLAN" } });

    const cc = await prisma.chargeCode.create({
      data: { enterpriseId, code: "TRF2", description: "Transfers", category: "TRANSPORTATION" },
    });
    const transfer = await prisma.allocation.create({
      data: {
        propertyId, code: "TRF-SB2", name: "Speedboat Transfer", type: "TRANSFER",
        chargeCodeId: cc.id, postingRhythm: "ARRIVAL_NIGHT", mode: "ADD_TO_RATE",
        rates: { create: { adultPrice: 100, childPrice: 50, effectiveFrom: new Date("2020-01-01") } },
      },
    });
    await prisma.ratePlanAllocation.create({ data: { ratePlanId, allocationId: transfer.id } });

    const dinner = await prisma.allocation.create({
      data: {
        propertyId, code: "DN2", name: "Dinner", type: "FNB",
        chargeCodeId: cc.id, postingRhythm: "EVERY_NIGHT", mode: "ADD_TO_RATE",
        rates: { create: { adultPrice: 30, childPrice: 15, effectiveFrom: new Date("2020-01-01") } },
      },
    });
    await prisma.mealPlan.create({
      data: { propertyId, code: "HB2", name: "Half Board", allocationLinks: { create: { allocationId: dinner.id } } },
    });

    // Meal plan selected: only dinner (meal-plan-linked) attaches — transfer
    // (rate-plan-linked) must NOT attach even though the same rate plan is assigned.
    await materializeReservationAllocations({ reservationId, propertyId, ratePlanId, mealPlanCode: "HB2" });
    let rows = await prisma.reservationAllocation.findMany({ where: { reservationId, source: { not: "MANUAL" } } });
    expect(rows.map((r) => r.allocationId)).toEqual([dinner.id]);

    // No meal plan selected: nothing linked attaches, even with the same rate plan.
    await materializeReservationAllocations({ reservationId, propertyId, ratePlanId, mealPlanCode: "NONE" });
    rows = await prisma.reservationAllocation.findMany({ where: { reservationId, source: { not: "MANUAL" } } });
    expect(rows).toHaveLength(0);
  });
});
