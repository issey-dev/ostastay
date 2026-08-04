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

// Hub-wide module outlet links (owner ruling 2026-07-30): one Spa outlet and one
// Excursion outlet per ENTERPRISE, shared by every property, selectable from any
// property's outlets — a cross-property link is a feature, not a scoping bug. The old
// per-property SpaSettings/ExcursionSettings links are gone.
describe("Hub-wide Spa/Excursion outlet links (/api/module-outlets)", () => {
  let enterpriseId: string;
  let adminId: string;
  let outletAId: string; // property A
  let outletBId: string; // property B, same enterprise
  let foreignOutletId: string; // another enterprise entirely

  const put = (body: object) =>
    asUser(adminId, () => moduleOutletsRoute.PUT(new Request("http://localhost/api/module-outlets", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })));
  const get = () => asUser(adminId, () => moduleOutletsRoute.GET());

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({ data: { name: "ModOut", slug: `test-modout-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const mkProp = (label: string) => prisma.property.create({
      data: { enterpriseId, name: label, code: `MO${label}-${uniq()}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    const propA = await mkProp("A");
    const propB = await mkProp("B");
    outletAId = (await prisma.outlet.create({ data: { propertyId: propA.id, name: "Spa A", code: "SPAA", outletType: "SPA" } })).id;
    outletBId = (await prisma.outlet.create({ data: { propertyId: propB.id, name: "Dive B", code: "DIVB", outletType: "RECREATION" } })).id;

    const other = await prisma.enterprise.create({ data: { name: "Other", slug: `test-modout-other-${uniq()}`, type: "STANDARD" } });
    const otherProp = await prisma.property.create({
      data: { enterpriseId: other.id, name: "O", code: `MOO-${uniq()}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
    foreignOutletId = (await prisma.outlet.create({ data: { propertyId: otherProp.id, name: "Foreign", code: "FRGN", outletType: "SPA" } })).id;

    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({ data: { enterpriseId, email: `modout-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "B", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } })).id;
  });

  it("links, persists, and unlinks the Spa outlet enterprise-wide", async () => {
    const linked = await put({ module: "SPA", outletId: outletAId });
    expect(linked.status).toBe(200);
    expect((await linked.json()).spaOutletId).toBe(outletAId);

    const read = await (await get()).json();
    expect(read.spaOutletId).toBe(outletAId);
    expect(read.spaOutlet.name).toBe("Spa A");

    const unlinked = await put({ module: "SPA", outletId: null });
    expect((await unlinked.json()).spaOutletId).toBeNull();
  });

  it("accepts an outlet from ANY property of the enterprise — cross-property is the point", async () => {
    // An outlet homed at property B is a legitimate hub-wide Excursion outlet.
    const res = await put({ module: "EXCURSIONS", outletId: outletBId });
    expect(res.status).toBe(200);
    expect((await res.json()).excursionOutletId).toBe(outletBId);
  });

  it("Spa and Excursions link independently", async () => {
    await put({ module: "SPA", outletId: outletAId });
    await put({ module: "EXCURSIONS", outletId: outletBId });
    const read = await (await get()).json();
    expect(read.spaOutletId).toBe(outletAId);
    expect(read.excursionOutletId).toBe(outletBId);
  });

  it("rejects an outlet belonging to another enterprise", async () => {
    const res = await put({ module: "SPA", outletId: foreignOutletId });
    expect(res.status).toBe(404);
  });

  it("rejects an unknown module", async () => {
    const res = await put({ module: "GYM", outletId: outletAId });
    expect(res.status).toBe(400);
  });

  it("GET lists outlets across every property of the enterprise, with their home property", async () => {
    const read = await (await get()).json();
    const names = read.outlets.map((o: { name: string }) => o.name);
    expect(names).toEqual(expect.arrayContaining(["Spa A", "Dive B"]));
    expect(names).not.toContain("Foreign");
    const diveB = read.outlets.find((o: { name: string }) => o.name === "Dive B");
    expect(diveB.property.name).toBe("B");
  });
});
