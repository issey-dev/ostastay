import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// Integrations and Green Tax are per PROPERTY since 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md,
// Phase 4). These tests pin the separation at the API: a single-property admin works on
// their own property's register, channel manager and online-booking setup, and never
// reaches another property's.

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
const greenTaxRoute = await import("@/app/api/hub/green-tax/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const ctx = {} as {
  enterpriseId: string;
  beachId: string;
  lagoonId: string;
  adminId: string;
  lagoonAdminId: string;
};

beforeAll(async () => {
  const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({ data: { name: "HI", slug: `test-hi-${uniq()}`, type: "STANDARD" } });
  ctx.enterpriseId = enterprise.id;
  const make = (name: string) =>
    prisma.property.create({
      data: { enterpriseId: enterprise.id, name, code: `HI-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
    });
  ctx.beachId = (await make("Beach")).id;
  ctx.lagoonId = (await make("Lagoon")).id;
  const passwordHash = await bcrypt.hash("password123", 10);
  ctx.adminId = (await prisma.user.create({
    data: { enterpriseId: enterprise.id, email: `hi-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
  })).id;
  ctx.lagoonAdminId = (await prisma.user.create({
    data: { enterpriseId: enterprise.id, email: `hi-lagoon-${uniq()}@test.local`, passwordHash, firstName: "L", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "PROPERTY", propertyId: ctx.lagoonId },
  })).id;
});

describe("Green Tax register — per property", () => {
  const register = (userId: string, propertyId: string) =>
    asUser(userId, () => greenTaxRoute.GET(new Request(`http://localhost/api/hub/green-tax?propertyId=${propertyId}&year=2026`)));

  it("opens each property's register to an enterprise admin", async () => {
    expect((await register(ctx.adminId, ctx.beachId)).status).toBe(200);
    expect((await register(ctx.adminId, ctx.lagoonId)).status).toBe(200);
  });

  it("opens only their own property's register to a single-property admin", async () => {
    expect((await register(ctx.lagoonAdminId, ctx.lagoonId)).status).toBe(200);
    expect((await register(ctx.lagoonAdminId, ctx.beachId)).status).toBe(403);
  });
});
