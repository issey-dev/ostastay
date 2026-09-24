import { describe, it, expect, beforeAll, vi } from "vitest";
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

const moduleOutletsRoute = await import("@/app/api/module-outlets/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

// Module outlet links, per PROPERTY since 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md,
// Phase 2): each property's Spa and Excursion charges post through one of its OWN
// outlets. Until then one outlet served the whole enterprise, so a spa appointment at one
// property billed through an outlet belonging to another — that cross-property link is
// exactly what these tests now refuse.
describe("Per-property Spa/Excursion outlet links (/api/module-outlets)", () => {
  let adminId: string;
  let lagoonAdminId: string;
  let propAId: string;
  let propBId: string;
  let outletAId: string; // property A
  let outletBId: string; // property B, same enterprise
  let foreignOutletId: string; // another enterprise entirely

  const put = (userId: string, body: object) =>
    asUser(userId, () => moduleOutletsRoute.PUT(new Request("http://localhost/api/module-outlets", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })));
  const get = (userId: string, propertyId: string) =>
    asUser(userId, () => moduleOutletsRoute.GET(new Request(`http://localhost/api/module-outlets?propertyId=${propertyId}`)));

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({ data: { name: "ModOut", slug: `test-modout-${uniq()}`, type: "STANDARD" } });
    const mkProp = (label: string) => prisma.property.create({
      data: { enterpriseId: enterprise.id, name: label, code: `MO${label}-${uniq()}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    propAId = (await mkProp("A")).id;
    propBId = (await mkProp("B")).id;
    outletAId = (await prisma.outlet.create({ data: { propertyId: propAId, name: "Spa A", code: "SPAA", outletType: "SPA" } })).id;
    outletBId = (await prisma.outlet.create({ data: { propertyId: propBId, name: "Dive B", code: "DIVB", outletType: "RECREATION" } })).id;

    const other = await prisma.enterprise.create({ data: { name: "Other", slug: `test-modout-other-${uniq()}`, type: "STANDARD" } });
    const otherProp = await prisma.property.create({
      data: { enterpriseId: other.id, name: "O", code: `MOO-${uniq()}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    foreignOutletId = (await prisma.outlet.create({ data: { propertyId: otherProp.id, name: "Foreign", code: "FRGN", outletType: "SPA" } })).id;

    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `modout-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "B", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } })).id;
    lagoonAdminId = (await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `modout-b-${uniq()}@test.local`, passwordHash, firstName: "B", lastName: "Admin", roles: { create: { roleId: roleIds["Admin"] } }, scope: "PROPERTY", propertyId: propBId } })).id;
  });

  it("links, persists and unlinks a property's own Spa outlet", async () => {
    const linked = await put(adminId, { propertyId: propAId, module: "SPA", outletId: outletAId });
    expect(linked.status).toBe(200);
    expect((await linked.json()).spaOutletId).toBe(outletAId);

    const read = await (await get(adminId, propAId)).json();
    expect(read.spaOutletId).toBe(outletAId);
    expect(read.spaOutlet.name).toBe("Spa A");

    const unlinked = await put(adminId, { propertyId: propAId, module: "SPA", outletId: null });
    expect((await unlinked.json()).spaOutletId).toBeNull();
  });

  it("refuses an outlet of ANOTHER property of the same enterprise", async () => {
    const res = await put(adminId, { propertyId: propAId, module: "EXCURSIONS", outletId: outletBId });
    expect(res.status).toBe(404);
  });

  it("keeps each property's links apart", async () => {
    await put(adminId, { propertyId: propAId, module: "SPA", outletId: outletAId });
    await put(adminId, { propertyId: propBId, module: "EXCURSIONS", outletId: outletBId });
    const a = await (await get(adminId, propAId)).json();
    const b = await (await get(adminId, propBId)).json();
    expect(a.spaOutletId).toBe(outletAId);
    expect(a.excursionOutletId).toBeNull();
    expect(b.excursionOutletId).toBe(outletBId);
    expect(b.spaOutletId).toBeNull();
  });

  it("rejects an outlet belonging to another enterprise", async () => {
    const res = await put(adminId, { propertyId: propAId, module: "SPA", outletId: foreignOutletId });
    expect(res.status).toBe(404);
  });

  it("rejects an unknown module and a missing property", async () => {
    expect((await put(adminId, { propertyId: propAId, module: "GYM", outletId: outletAId })).status).toBe(400);
    expect((await put(adminId, { module: "SPA", outletId: outletAId })).status).toBe(400);
  });

  it("GET lists only that property's outlets", async () => {
    const read = await (await get(adminId, propAId)).json();
    const names = read.outlets.map((o: { name: string }) => o.name);
    expect(names).toEqual(["Spa A"]);
  });

  it("a single-property admin can link their own property's outlet, never another's", async () => {
    expect((await put(lagoonAdminId, { propertyId: propBId, module: "EXCURSIONS", outletId: outletBId })).status).toBe(200);
    expect((await put(lagoonAdminId, { propertyId: propAId, module: "SPA", outletId: outletAId })).status).toBe(403);
    expect((await get(lagoonAdminId, propAId)).status).toBe(403);
  });
});
