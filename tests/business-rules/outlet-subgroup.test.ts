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
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");
const { provisionOutletSubgroup } = await import("@/lib/posting/outlet-subgroup");
const { nextOutletSubgroupCode, TAX_CODES } = await import("@/lib/posting/charge-tree");
const outletsRoute = await import("@/app/api/outlets/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

async function setup() {
  const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({ data: { name: "OutletSub", slug: `test-outletsub-${uniq()}`, type: "STANDARD" } });
  const property = await prisma.property.create({
    data: { enterpriseId: enterprise.id, name: "P", code: `OSB-${uniq()}`, legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
  });
  await ensureChargeTree(prisma, enterprise.id);
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `osb-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "B", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
  return { enterpriseId: enterprise.id, propertyId: property.id, adminId: admin.id };
}

describe("outlet subgroup band allocation (pure)", () => {
  it("adopts the band's seeded default when it is unowned", () => {
    expect(nextOutletSubgroupCode("RESTAURANT", ["20RV", "29RV"], ["20RV"])).toEqual({ adopt: "20RV" });
  });

  it("creates the next free number once the default is owned", () => {
    expect(nextOutletSubgroupCode("RESTAURANT", ["20RV", "29RV"], [])).toEqual({ create: "21RV" });
    expect(nextOutletSubgroupCode("RESTAURANT", ["20RV", "21RV", "29RV"], [])).toEqual({ create: "22RV" });
  });

  it("never allocates 29RV to an outlet — it's reserved for Meal Plans", () => {
    const taken = ["20RV", "21RV", "22RV", "23RV", "24RV", "25RV", "26RV", "27RV", "28RV", "29RV"];
    expect(nextOutletSubgroupCode("RESTAURANT", taken, [])).toBeNull();
  });

  it("spa and excursion outlets draw from their own bands", () => {
    expect(nextOutletSubgroupCode("SPA", ["30RV"], ["30RV"])).toEqual({ adopt: "30RV" });
    expect(nextOutletSubgroupCode("SPA", ["30RV"], [])).toEqual({ create: "31RV" });
    expect(nextOutletSubgroupCode("RECREATION", ["40RV"], [])).toEqual({ create: "41RV" });
  });

  it("returns null for an unbanded outlet type", () => {
    expect(nextOutletSubgroupCode("NOT_A_TYPE", [], [])).toBeNull();
  });
});

describe("outlet subgroup provisioning (DB)", () => {
  it("first F&B outlet adopts 20RV (renamed to it), the second gets 21RV with its own codes", async () => {
    const { enterpriseId, propertyId } = await setup();

    const outletA = await prisma.outlet.create({ data: { propertyId, name: "Main Restaurant", code: "REST", outletType: "RESTAURANT" } });
    const first = await provisionOutletSubgroup(prisma, { enterpriseId, outletId: outletA.id, outletName: outletA.name, outletType: "RESTAURANT" });
    expect(first).toMatchObject({ subgroupCode: "20RV", adopted: true });

    const adopted = await prisma.chargeSubgroup.findUniqueOrThrow({ where: { enterpriseId_code: { enterpriseId, code: "20RV" } } });
    expect(adopted.outletId).toBe(outletA.id);
    expect(adopted.name).toBe("Main Restaurant");

    const outletB = await prisma.outlet.create({ data: { propertyId, name: "Beach Grill", code: "GRILL", outletType: "RESTAURANT" } });
    const second = await provisionOutletSubgroup(prisma, { enterpriseId, outletId: outletB.id, outletName: outletB.name, outletType: "RESTAURANT" });
    expect(second).toMatchObject({ subgroupCode: "21RV", adopted: false });

    // Its template codes exist under 21RV, wired to the global tax codes.
    const dinner = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId, code: "2103" } },
      include: { chargeSubgroup: true, generatesFrom: { include: { generatedCode: true } } },
    });
    expect(dinner.chargeSubgroup.code).toBe("21RV");
    expect(dinner.chargeSubgroup.outletId).toBe(outletB.id);
    const targets = dinner.generatesFrom.map((g) => g.generatedCode.code).sort();
    expect(targets).toEqual([TAX_CODES.serviceCharge, TAX_CODES.gst].sort());

    // And the outlet's picker pool starts populated with them.
    const pool = await prisma.outletChargeCode.findMany({ where: { outletId: outletB.id }, include: { chargeCode: true } });
    expect(pool.map((p) => p.chargeCode.code).sort()).toEqual(["2101", "2102", "2103", "2104"]);
  });

  it("re-provisioning the same outlet is a no-op — never burns a second band number", async () => {
    const { enterpriseId, propertyId } = await setup();
    const outlet = await prisma.outlet.create({ data: { propertyId, name: "Spa One", code: "SPA1", outletType: "SPA" } });
    const first = await provisionOutletSubgroup(prisma, { enterpriseId, outletId: outlet.id, outletName: outlet.name, outletType: "SPA" });
    const again = await provisionOutletSubgroup(prisma, { enterpriseId, outletId: outlet.id, outletName: outlet.name, outletType: "SPA" });
    expect(first?.subgroupCode).toBe("30RV");
    expect(again).toMatchObject({ subgroupCode: "30RV", codesCreated: 0 });
    expect(await prisma.chargeSubgroup.count({ where: { outletId: outlet.id } })).toBe(1);
  });

  it("POST /api/outlets provisions the subgroup as part of outlet creation", async () => {
    const { enterpriseId, propertyId, adminId } = await setup();
    const res = await asUser(adminId, () => outletsRoute.POST(
      new Request("http://localhost/api/outlets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId, name: "Dive Shack", code: "DIVE", outletType: "RECREATION" }),
      })
    ));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.provisionedSubgroup).toBe("40RV");

    const sub = await prisma.chargeSubgroup.findUniqueOrThrow({ where: { enterpriseId_code: { enterpriseId, code: "40RV" } } });
    expect(sub.outletId).toBe(body.id);
  });
});
