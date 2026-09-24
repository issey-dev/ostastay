import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// Dropdown lists live at two levels since 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md,
// Phase 3): reservation, housekeeping, transport and room-feature lists are each
// PROPERTY's own; guest-profile lists and Job Functions stay the ENTERPRISE's. These tests
// pin the separation at the API: one property's list never shows at another, a
// single-property admin edits only their own property's lists and never an enterprise
// list, and a code is unique within its own list only.

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
const route = await import("@/app/api/settings/system-codes/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const get = (userId: string, query: Record<string, string>) =>
  asUser(userId, () => route.GET(new Request(`http://localhost/api/settings/system-codes?${new URLSearchParams(query)}`)));

const send = (userId: string, method: "POST" | "PUT", body: unknown) =>
  asUser(userId, () =>
    route[method](
      new Request("http://localhost/api/settings/system-codes", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    )
  );

const codesOf = async (res: Response) => ((await res.json()) as { code: string }[]).map((c) => c.code).sort();

describe("Dropdown lists — per property vs enterprise", () => {
  let enterpriseId: string;
  let beachId: string;
  let lagoonId: string;
  let adminId: string;
  let lagoonAdminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "PL", slug: `test-pl-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const make = (name: string) =>
      prisma.property.create({
        data: { enterpriseId, name, code: `PL-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
      });
    beachId = (await make("Beach")).id;
    lagoonId = (await make("Lagoon")).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({
      data: { enterpriseId, email: `pl-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    })).id;
    lagoonAdminId = (await prisma.user.create({
      data: { enterpriseId, email: `pl-lagoon-${uniq()}@test.local`, passwordHash, firstName: "L", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "PROPERTY", propertyId: lagoonId },
    })).id;
  });

  it("needs a property to read or write a property list", async () => {
    expect((await get(adminId, { category: "SPECIAL_REQUEST" })).status).toBe(400);
    expect((await send(adminId, "POST", { category: "SPECIAL_REQUEST", code: "X", value: "X" })).status).toBe(400);
  });

  it("keeps one property's list off every other property", async () => {
    expect((await send(adminId, "POST", { category: "SPECIAL_REQUEST", propertyId: beachId, code: "SUNSET", value: "Sunset dinner" })).status).toBe(200);
    expect(await codesOf(await get(adminId, { category: "SPECIAL_REQUEST", propertyId: beachId }))).toEqual(["SUNSET"]);
    expect(await codesOf(await get(adminId, { category: "SPECIAL_REQUEST", propertyId: lagoonId }))).toEqual([]);
  });

  it("lets two properties use the same code, but never twice in one list", async () => {
    expect((await send(adminId, "POST", { category: "SPECIAL_REQUEST", propertyId: lagoonId, code: "SUNSET", value: "Sandbank sunset" })).status).toBe(200);
    expect((await send(adminId, "POST", { category: "SPECIAL_REQUEST", propertyId: lagoonId, code: "SUNSET", value: "Again" })).status).toBe(400);
  });

  it("keeps an enterprise list at enterprise level, unique there", async () => {
    // A propertyId sent with an enterprise list is ignored — the list is the enterprise's.
    expect((await send(adminId, "POST", { category: "GENDER", propertyId: beachId, code: "X", value: "Other" })).status).toBe(200);
    const row = await prisma.systemCode.findFirstOrThrow({ where: { enterpriseId, category: "GENDER", code: "X" } });
    expect(row.propertyId).toBeNull();
    expect((await send(adminId, "POST", { category: "GENDER", code: "X", value: "Again" })).status).toBe(400);
    // ...and every property's staff read the same one.
    expect(await codesOf(await get(lagoonAdminId, { category: "GENDER" }))).toEqual(["X"]);
  });

  it("lets a single-property admin edit their own property's lists only — never an enterprise list", async () => {
    expect((await send(lagoonAdminId, "POST", { category: "TRANSPORT_TYPE", propertyId: lagoonId, code: "SEAPLANE", value: "Seaplane" })).status).toBe(200);
    expect((await send(lagoonAdminId, "POST", { category: "TRANSPORT_TYPE", propertyId: beachId, code: "SPEEDBOAT", value: "Speedboat" })).status).toBe(403);
    expect((await get(lagoonAdminId, { category: "SPECIAL_REQUEST", propertyId: beachId })).status).toBe(403);
    expect((await send(lagoonAdminId, "POST", { category: "NATIONALITY", code: "MV", value: "Maldivian" })).status).toBe(403);

    const beachRow = await prisma.systemCode.findFirstOrThrow({ where: { propertyId: beachId, code: "SUNSET" } });
    expect((await send(lagoonAdminId, "PUT", { id: beachRow.id, value: "Hijacked" })).status).toBe(403);
    expect((await send(lagoonAdminId, "PUT", [{ id: beachRow.id, sortOrder: 9, isActive: true, value: "Hijacked" }])).status).toBe(403);
    expect((await prisma.systemCode.findUniqueOrThrow({ where: { id: beachRow.id } })).value).toBe("Sunset dinner");

    const genderRow = await prisma.systemCode.findFirstOrThrow({ where: { enterpriseId, category: "GENDER", code: "X" } });
    expect((await send(lagoonAdminId, "PUT", { id: genderRow.id, value: "Hijacked" })).status).toBe(403);
  });

  it("lists everything a page can show: the enterprise's lists plus the given property's", async () => {
    const res = await get(adminId, { propertyId: lagoonId });
    const rows = (await res.json()) as { category: string; code: string; propertyId: string | null }[];
    expect(rows.some((r) => r.category === "GENDER")).toBe(true);
    expect(rows.some((r) => r.category === "SPECIAL_REQUEST" && r.propertyId === lagoonId)).toBe(true);
    expect(rows.some((r) => r.propertyId === beachId)).toBe(false);
  });
});
