import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Route-level checks for Hub › General (PUT /api/properties/[id]) and Finance › Custom
// Tax (DELETE /api/taxes/[id]): friendly 409s instead of raw constraint errors.

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
const propertyRoute = await import("@/app/api/properties/[id]/route");
const taxRoute = await import("@/app/api/taxes/[id]/route");
const { customChargeCode } = await import("../helpers/charge-codes");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const put = (id: string, body: unknown) =>
  propertyRoute.PUT(
    new Request(`http://localhost/api/properties/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
const del = (id: string) =>
  taxRoute.DELETE(new Request(`http://localhost/api/taxes/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

describe("Property profile PUT and Custom Tax DELETE", () => {
  const stamp = Date.now().toString(36).slice(-3).toUpperCase();
  const codeA = `A${stamp}`;
  const codeB = `B${stamp}`;
  let adminId: string;
  let propertyA: string;
  let usedProfileId: string;
  let freeProfileId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({
      data: { name: "Profile Routes", slug: `test-profile-routes-${Date.now()}`, type: "STANDARD" },
    });
    const base = { enterpriseId: enterprise.id, legalName: "Test LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" };
    propertyA = (await prisma.property.create({ data: { ...base, name: "Prop A", code: codeA, starRating: 4 } })).id;
    await prisma.property.create({ data: { ...base, name: "Prop B", code: codeB } });

    const used = await prisma.taxProfile.create({ data: { enterpriseId: enterprise.id, propertyId: propertyA, name: "Used Profile" } });
    usedProfileId = used.id;
    await customChargeCode({ propertyId: propertyA }, { code: "UPX", description: "Uses profile", useDefaultTax: false, taxProfileId: used.id, subgroupCode: "20RV" });
    freeProfileId = (await prisma.taxProfile.create({ data: { enterpriseId: enterprise.id, propertyId: propertyA, name: "Free Profile" } })).id;

    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id, email: `pp-admin-${Date.now()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Admin", lastName: "PP", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  it("refuses a short code another property already uses with a readable 409", async () => {
    const res = await asUser(adminId, () => put(propertyA, { code: codeB.toLowerCase() }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already in use");
    expect(body.fieldErrors.code).toBeTruthy();
  });

  it("rejects invalid profile fields with per-field messages", async () => {
    const res = await asUser(adminId, () => put(propertyA, { name: "X", starRating: 9, contactEmail: "nope" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["contactEmail", "name", "starRating"]);
  });

  it("a one-field PUT from another panel leaves the profile (incl. star rating) untouched", async () => {
    const res = await asUser(adminId, () => put(propertyA, { allocationCalculationMode: "MEAL_PLAN" }));
    expect(res.status).toBe(200);
    const row = await prisma.property.findUniqueOrThrow({ where: { id: propertyA } });
    expect(row.starRating).toBe(4);
    expect(row.name).toBe("Prop A");
  });

  it("saves a valid profile, upper-casing the code", async () => {
    const res = await asUser(adminId, () => put(propertyA, { name: "Prop A2", code: `c${stamp}`, starRating: null, contactEmail: "" }));
    expect(res.status).toBe(200);
    const row = await prisma.property.findUniqueOrThrow({ where: { id: propertyA } });
    expect(row.code).toBe(`C${stamp}`);
    expect(row.starRating).toBeNull();
    expect(row.contactEmail).toBeNull();
  });

  it("refuses to delete a Custom Tax profile a charge code uses", async () => {
    const res = await asUser(adminId, () => del(usedProfileId));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("1 charge code");
    expect(await prisma.taxProfile.findUnique({ where: { id: usedProfileId } })).not.toBeNull();
  });

  it("deletes an unused Custom Tax profile", async () => {
    const res = await asUser(adminId, () => del(freeProfileId));
    expect(res.status).toBe(204);
    expect(await prisma.taxProfile.findUnique({ where: { id: freeProfileId } })).toBeNull();
  });
});
