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

const propertyModulesRoute = await import("@/app/api/licenses/property-modules/route");
const spaSettingsRoute = await import("@/app/api/spa/settings/route");
const excursionSettingsRoute = await import("@/app/api/excursions/settings/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Spa/Excursion module-level outlet link", () => {
  let ostaAdminId: string;
  let adminId: string;
  let propertyId: string;
  let outletId: string;
  let otherPropertyOutletId: string;

  const putSpa = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      spaSettingsRoute.PUT(new Request("http://localhost/api/spa/settings", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }))
    );
  const getSpa = () =>
    asUser(adminId, () => spaSettingsRoute.GET(new Request(`http://localhost/api/spa/settings?propertyId=${propertyId}`)));

  const putExc = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      excursionSettingsRoute.PUT(new Request("http://localhost/api/excursions/settings", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }))
    );
  const getExc = () =>
    asUser(adminId, () => excursionSettingsRoute.GET(new Request(`http://localhost/api/excursions/settings?propertyId=${propertyId}`)));

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);
    const ostaAdmin = await prisma.user.create({ data: { enterpriseId: osta.id, email: `oml-osta-${uniq()}@test.local`, passwordHash, firstName: "Osta", lastName: "Admin", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    ostaAdminId = ostaAdmin.id;

    const enterprise = await prisma.enterprise.create({ data: { name: "Outlet Link", slug: `test-outletlink-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({ data: { enterpriseId: enterprise.id, name: "OML Prop", code: `OML-${uniq()}`, legalName: "OML LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } });
    propertyId = property.id;
    const otherProperty = await prisma.property.create({ data: { enterpriseId: enterprise.id, name: "OML Other", code: `OMLO-${uniq()}`, legalName: "OMLO LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } });

    for (const mod of ["SPA", "EXCURSIONS"]) {
      await asUser(ostaAdminId, () =>
        propertyModulesRoute.PATCH(new Request("http://localhost/api/licenses/property-modules", {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId, module: mod, enabled: true }),
        }))
      );
    }

    const outlet = await prisma.outlet.create({ data: { propertyId, name: "Ocean Spa", code: "SPA" } });
    outletId = outlet.id;
    const otherOutlet = await prisma.outlet.create({ data: { propertyId: otherProperty.id, name: "Other Bar", code: "OBAR" } });
    otherPropertyOutletId = otherOutlet.id;

    const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `oml-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "OML", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    adminId = admin.id;
  });

  it("Spa settings: links, persists, and unlinks an outlet", async () => {
    const linked = await putSpa({ propertyId, outletId });
    expect(linked.status).toBe(200);
    expect((await linked.json()).outletId).toBe(outletId);
    expect((await (await getSpa()).json()).outletId).toBe(outletId);

    const unlinked = await putSpa({ propertyId, outletId: null });
    expect((await unlinked.json()).outletId).toBeNull();
  });

  it("Spa settings: rejects an outlet from another property", async () => {
    const res = await putSpa({ propertyId, outletId: otherPropertyOutletId });
    expect(res.status).toBe(404);
  });

  it("Excursion settings: links, persists, and unlinks an outlet", async () => {
    const linked = await putExc({ propertyId, outletId });
    expect(linked.status).toBe(200);
    expect((await linked.json()).outletId).toBe(outletId);
    expect((await (await getExc()).json()).outletId).toBe(outletId);

    const unlinked = await putExc({ propertyId, outletId: null });
    expect((await unlinked.json()).outletId).toBeNull();
  });

  it("Excursion settings: rejects an outlet from another property", async () => {
    const res = await putExc({ propertyId, outletId: otherPropertyOutletId });
    expect(res.status).toBe(404);
  });
});
