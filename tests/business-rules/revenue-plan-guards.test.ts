import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";

// Revenue › Rate Plans / Meal Plans / Allocations: API guards and the Price Calendar's
// effective-price view. See src/lib/revenue-usage.ts and src/lib/effective-price-calendar.ts.

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value); },
    delete: (name: string) => { cookieJar.delete(name); },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const ratePlansRoute = await import("@/app/api/rate-plans/route");
const ratePlanIdRoute = await import("@/app/api/rate-plans/[id]/route");
const mealPlanIdRoute = await import("@/app/api/meal-plans/[id]/route");
const allocationIdRoute = await import("@/app/api/allocations/[id]/route");
const priceCalendarRoute = await import("@/app/api/price-calendar/route");
const { customChargeCode } = await import("../helpers/charge-codes");
const { ratePlanFormSchema, mealPlanFormSchema, emptyRatePlanForm, ratePlanPayload } = await import("@/lib/revenue-plan-schemas");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const json = (method: string, body: unknown) =>
  ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

async function setup(tag: string) {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({
    data: { name: tag, slug: `test-rpg-${tag}-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `RPG-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `rpg-${tag}-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: tag, roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
    },
  });
  const roomType = await prisma.roomType.create({ data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 } });
  const room = await prisma.room.create({ data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: "101" } });
  const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "G", lastName: "T" } });
  return { enterpriseId: enterprise.id, propertyId: property.id, adminId: admin.id, roomTypeId: roomType.id, roomId: room.id, guestUpid: guest.upid };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function book(s: Setup, ratePlanId: string, mealPlan = "NONE") {
  const from = new Date("2026-10-01T00:00:00Z");
  const to = new Date("2026-10-03T00:00:00Z");
  return prisma.reservation.create({
    data: {
      propertyId: s.propertyId, confirmationNo: `RPG-${uniq()}`, primaryGuestId: s.guestUpid,
      checkInDate: from, checkOutDate: to, status: "CONFIRMED", adults: 2, children: 0, mealPlan,
      assignments: { create: { roomTypeId: s.roomTypeId, roomId: s.roomId, ratePlanId, startDate: from, endDate: to } },
    },
  });
}

describe("Rate plan API", () => {
  it("keeps priority 0 on create (blank still defaults to 10)", async () => {
    const s = await setup("prio");
    const zero = await asUser(s.adminId, () =>
      ratePlansRoute.POST(new Request("http://localhost/api/rate-plans", json("POST", { propertyId: s.propertyId, code: "TOP", name: "Top", priority: 0 })))
    );
    expect(zero.status).toBe(201);
    expect((await zero.json()).priority).toBe(0);

    const blank = await asUser(s.adminId, () =>
      ratePlansRoute.POST(new Request("http://localhost/api/rate-plans", json("POST", { propertyId: s.propertyId, code: "MID", name: "Mid", priority: "" })))
    );
    expect((await blank.json()).priority).toBe(10);
  });

  it("answers a duplicate code with a friendly 409, on create and on rename", async () => {
    const s = await setup("dup");
    await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "BAR", name: "BAR" } });
    const other = await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "NRF", name: "Non-Refundable" } });

    const create = await asUser(s.adminId, () =>
      ratePlansRoute.POST(new Request("http://localhost/api/rate-plans", json("POST", { propertyId: s.propertyId, code: "bar", name: "Again" })))
    );
    expect(create.status).toBe(409);
    expect((await create.json()).error).toMatch(/already exists/i);

    const rename = await asUser(s.adminId, () =>
      ratePlanIdRoute.PUT(
        new Request(`http://localhost/api/rate-plans/${other.id}`, json("PUT", { code: "BAR", name: "Non-Refundable", priority: 5 })),
        params(other.id)
      )
    );
    expect(rename.status).toBe(409);
    expect((await rename.json()).error).toMatch(/already exists/i);
  });

  it("returns a validation failure as a readable string, not the raw Zod issue array", async () => {
    const s = await setup("zod");
    const plan = await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "BAR", name: "BAR" } });
    const res = await asUser(s.adminId, () =>
      ratePlanIdRoute.PUT(new Request(`http://localhost/api/rate-plans/${plan.id}`, json("PUT", { code: "BAR", name: "x", priority: 1 })), params(plan.id))
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/^name:/);
  });

  it("refuses to delete, or re-code, a rate plan reservations are priced on — other edits still save", async () => {
    const s = await setup("used-rp");
    const plan = await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "BAR", name: "BAR" } });
    await book(s, plan.id);

    const del = await asUser(s.adminId, () =>
      ratePlanIdRoute.DELETE(new Request(`http://localhost/api/rate-plans/${plan.id}`, { method: "DELETE" }), params(plan.id))
    );
    expect(del.status).toBe(409);
    expect((await del.json()).error).toMatch(/used by 1 reservation/i);

    const recode = await asUser(s.adminId, () =>
      ratePlanIdRoute.PUT(new Request(`http://localhost/api/rate-plans/${plan.id}`, json("PUT", { code: "BAR2", name: "BAR", priority: 1 })), params(plan.id))
    );
    expect(recode.status).toBe(409);

    const rename = await asUser(s.adminId, () =>
      ratePlanIdRoute.PUT(new Request(`http://localhost/api/rate-plans/${plan.id}`, json("PUT", { code: "BAR", name: "Best Available", priority: 0 })), params(plan.id))
    );
    expect(rename.status).toBe(200);
    const after = await prisma.ratePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(after).toMatchObject({ code: "BAR", name: "Best Available", priority: 0 });
  });
});

describe("Meal plan API", () => {
  it("freezes the code and blocks delete once a reservation stores it; unused plans still delete", async () => {
    const s = await setup("used-mp");
    const plan = await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "BAR", name: "BAR" } });
    const bb = await prisma.mealPlan.create({ data: { propertyId: s.propertyId, code: "BB", name: "Bed & Breakfast" } });
    const hb = await prisma.mealPlan.create({ data: { propertyId: s.propertyId, code: "HB", name: "Half Board" } });
    await book(s, plan.id, "BB");

    const recode = await asUser(s.adminId, () =>
      mealPlanIdRoute.PUT(new Request(`http://localhost/api/meal-plans/${bb.id}`, json("PUT", { code: "BBX", name: "Bed & Breakfast" })), params(bb.id))
    );
    expect(recode.status).toBe(409);
    expect((await recode.json()).error).toMatch(/deactivate/i);

    const deactivate = await asUser(s.adminId, () =>
      mealPlanIdRoute.PUT(new Request(`http://localhost/api/meal-plans/${bb.id}`, json("PUT", { code: "BB", name: "B&B", isActive: false })), params(bb.id))
    );
    expect(deactivate.status).toBe(200);

    const del = await asUser(s.adminId, () =>
      mealPlanIdRoute.DELETE(new Request(`http://localhost/api/meal-plans/${bb.id}`, { method: "DELETE" }), params(bb.id))
    );
    expect(del.status).toBe(409);
    expect(await prisma.mealPlan.findUnique({ where: { id: bb.id } })).not.toBeNull();

    const delUnused = await asUser(s.adminId, () =>
      mealPlanIdRoute.DELETE(new Request(`http://localhost/api/meal-plans/${hb.id}`, { method: "DELETE" }), params(hb.id))
    );
    expect(delUnused.status).toBe(204);
  });
});

describe("Allocation API", () => {
  it("freezes the code and blocks delete once attached to a reservation", async () => {
    const s = await setup("used-al");
    const code = await customChargeCode({ propertyId: s.propertyId }, { code: "2201", description: "Breakfast revenue" });
    const bf = await prisma.allocation.create({ data: { propertyId: s.propertyId, code: "BF", name: "Breakfast", chargeCodeId: code.id } });
    const plan = await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "BAR", name: "BAR" } });
    const res = await book(s, plan.id);
    await prisma.reservationAllocation.create({ data: { reservationId: res.id, allocationId: bf.id, source: "MANUAL" } });

    const recode = await asUser(s.adminId, () =>
      allocationIdRoute.PUT(new Request(`http://localhost/api/allocations/${bf.id}`, json("PUT", { code: "BFST" })), params(bf.id))
    );
    expect(recode.status).toBe(409);

    const rename = await asUser(s.adminId, () =>
      allocationIdRoute.PUT(new Request(`http://localhost/api/allocations/${bf.id}`, json("PUT", { code: "BF", name: "Full Breakfast" })), params(bf.id))
    );
    expect(rename.status).toBe(200);

    const del = await asUser(s.adminId, () =>
      allocationIdRoute.DELETE(new Request(`http://localhost/api/allocations/${bf.id}`, { method: "DELETE" }), params(bf.id))
    );
    expect(del.status).toBe(409);
    expect((await del.json()).error).toMatch(/deactivate/i);
  });
});

describe("Price Calendar: effective price, the way Night Audit resolves it", () => {
  it("shows a derived plan as parent + adjustment, falling back to Base + adjustment, and leaves unpriced nights out", async () => {
    const s = await setup("pc");
    const base = await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "BASE", name: "Base Rate", isLocked: true, priority: 999 } });
    const bar = await prisma.ratePlan.create({ data: { propertyId: s.propertyId, code: "BAR", name: "BAR" } });
    const barBb = await prisma.ratePlan.create({
      data: { propertyId: s.propertyId, code: "BAR-BB", name: "BAR BB", parentRatePlanId: bar.id, derivedAdjustmentType: "FLAT", derivedAdjustmentValue: 20 },
    });
    const d = (day: number) => new Date(Date.UTC(2026, 10, day));
    await prisma.priceCalendar.createMany({
      data: [
        { ratePlanId: bar.id, roomTypeId: s.roomTypeId, date: d(1), price: 100, extraAdultPrice: 30 },
        { ratePlanId: base.id, roomTypeId: s.roomTypeId, date: d(1), price: 80 },
        { ratePlanId: base.id, roomTypeId: s.roomTypeId, date: d(2), price: 80 },
      ],
    });

    const get = (ratePlanId: string) =>
      asUser(s.adminId, async () => {
        const res = await priceCalendarRoute.GET(
          new Request(`http://localhost/api/price-calendar?ratePlanId=${ratePlanId}&roomTypeId=${s.roomTypeId}&startDate=2026-11-01&endDate=2026-11-03`)
        );
        expect(res.status).toBe(200);
        return (await res.json()) as Array<{ date: string; price: number; extraAdultPrice: number | null; source: string; derived: boolean }>;
      });

    const derived = await get(barBb.id);
    expect(derived.map((e) => [e.date.slice(0, 10), e.price, e.extraAdultPrice, e.source, e.derived])).toEqual([
      ["2026-11-01", 120, 30, "OWN", true],
      ["2026-11-02", 100, null, "BASE_FALLBACK", true],
    ]);

    // A plain plan: its own price where set, the Base Rate where not.
    const plain = await get(bar.id);
    expect(plain.map((e) => [e.date.slice(0, 10), e.price, e.source, e.derived])).toEqual([
      ["2026-11-01", 100, "OWN", false],
      ["2026-11-02", 80, "BASE_FALLBACK", false],
    ]);
  });
});

describe("Rate / Meal plan form schemas (APP STANDARD 001)", () => {
  it("accepts priority 0 and sends it as 0", () => {
    const values = { ...emptyRatePlanForm, code: "TOP", name: "Top", priority: "0" };
    expect(ratePlanFormSchema.safeParse(values).success).toBe(true);
    expect(ratePlanPayload(values, "p").priority).toBe(0);
  });

  it("rejects a blank priority, the reserved BASE code, and a derived plan without an adjustment", () => {
    expect(ratePlanFormSchema.safeParse({ ...emptyRatePlanForm, code: "TOP", name: "Top", priority: "" }).success).toBe(false);
    expect(ratePlanFormSchema.safeParse({ ...emptyRatePlanForm, code: "base", name: "Sneaky" }).success).toBe(false);
    // The locked Base plan itself keeps its code.
    expect(ratePlanFormSchema.safeParse({ ...emptyRatePlanForm, isLocked: true, code: "BASE", name: "Base Rate" }).success).toBe(true);
    const derived = { ...emptyRatePlanForm, code: "BAR-BB", name: "BAR BB", parentRatePlanId: "x", derivedAdjustmentValue: "" };
    const r = ratePlanFormSchema.safeParse(derived);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["derivedAdjustmentValue"]);
  });

  it("requires a meal plan code and name", () => {
    expect(mealPlanFormSchema.safeParse({ code: "", name: "Bed & Breakfast", isActive: true, allocationIds: [] }).success).toBe(false);
    expect(mealPlanFormSchema.safeParse({ code: "BB", name: "", isActive: true, allocationIds: [] }).success).toBe(false);
    expect(mealPlanFormSchema.safeParse({ code: "BB", name: "Bed & Breakfast", isActive: true, allocationIds: [] }).success).toBe(true);
  });
});
