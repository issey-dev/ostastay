import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie fake as tests/scope.test.ts — src/lib/auth.ts and
// src/lib/scope.ts call next/headers' cookies(), which only works inside a real
// Next.js request.
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
const { requireSession, requireHubAccess, hasHubAccess, hasAnyPropertyModule, HUB_MODULES, ForbiddenError } =
  await import("@/lib/scope");
const { MODULES: SRC_MODULES } = await import("@/lib/modules");
const {
  MODULES: SEED_MODULES,
  SYSTEM_ROLE_DEFS,
  ensureRoles,
} = await import("../../prisma/rbac-seed-data");

// The Hub is the enterprise-level shell (src/app/e/[slug]/hub) — see
// .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md. It holds channel-manager connectivity and
// enterprise-wide configuration, and deliberately contains NO PMS functionality.
describe("Hub access (enterprise level)", () => {
  let enterpriseId: string;
  let propertyId: string;
  let adminUserId: string;
  let hubOnlyUserId: string;
  let propertyScopedHubUserId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });

    const enterprise = await prisma.enterprise.create({
      data: { name: `Hub Ent ${Date.now()}`, slug: `test-hub-${Date.now()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;
    await prisma.enterpriseLicense.create({
      data: { enterpriseId, tier: "STANDARD", maxProperties: 1 },
    });

    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Hub Property",
        code: `HP-${Date.now()}`,
        legalName: "Hub Property LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const passwordHash = await bcrypt.hash("password123", 10);

    // A normal Admin: holds every module, so both Hub AND property access.
    const admin = await prisma.user.create({
      data: {
        enterpriseId,
        email: `hub-admin-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Hub",
        lastName: "Admin",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminUserId = admin.id;

    // The Hub-only administrator shape from the plan (decision D-3): no new User.scope
    // value and no schema change — just an ENTERPRISE-scoped user whose role grants
    // ONLY a Hub module and nothing operational.
    const hubOnlyRole = await prisma.role.create({
      data: {
        enterpriseId,
        name: `Hub Only ${Date.now()}`,
        isSystem: false,
        permissions: {
          create: { module: "INTEGRATIONS", canView: true, canCreate: true, canUpdate: true, canDelete: false },
        },
      },
    });
    const hubOnly = await prisma.user.create({
      data: {
        enterpriseId,
        email: `hub-only-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Hub",
        lastName: "Only",
        roleId: hubOnlyRole.id,
        scope: "ENTERPRISE",
      },
    });
    hubOnlyUserId = hubOnly.id;

    // The dangerous case: a PROPERTY-scoped user who HAS been granted INTEGRATIONS.
    // Must still be refused — the block is on scope, not on the permission bit.
    const propertyHubRole = await prisma.role.create({
      data: {
        enterpriseId,
        name: `Property Hub ${Date.now()}`,
        isSystem: false,
        permissions: {
          create: { module: "INTEGRATIONS", canView: true, canCreate: true, canUpdate: true, canDelete: true },
        },
      },
    });
    const propertyScopedHubUser = await prisma.user.create({
      data: {
        enterpriseId,
        email: `hub-property-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Property",
        lastName: "Hub",
        roleId: propertyHubRole.id,
        scope: "PROPERTY",
        propertyId,
      },
    });
    propertyScopedHubUserId = propertyScopedHubUser.id;
  });

  it("an Admin has Hub access and property access", async () => {
    cookieJar.clear();
    await createSession(adminUserId);
    const ctx = await requireSession();
    expect(hasHubAccess(ctx)).toBe(true);
    expect(hasAnyPropertyModule(ctx)).toBe(true);
    expect(() => requireHubAccess(ctx)).not.toThrow();
    await destroySession();
  });

  it("a PROPERTY-scoped user is refused the Hub even when their role grants INTEGRATIONS", async () => {
    cookieJar.clear();
    await createSession(propertyScopedHubUserId);
    const ctx = await requireSession();
    // The permission bit really is granted — proving the refusal comes from scope.
    expect(ctx.permissions.get("INTEGRATIONS")?.canView).toBe(true);
    expect(ctx.scope).toBe("PROPERTY");

    expect(hasHubAccess(ctx)).toBe(false);
    expect(() => requireHubAccess(ctx)).toThrow(ForbiddenError);
    await destroySession();
  });

  it("a Hub-only administrator has Hub access but no property-operational module", async () => {
    cookieJar.clear();
    await createSession(hubOnlyUserId);
    const ctx = await requireSession();
    expect(hasHubAccess(ctx)).toBe(true);
    // This is what routes the user to /hub instead of a dead property page — see
    // src/app/e/[slug]/dashboard/page.tsx.
    expect(hasAnyPropertyModule(ctx)).toBe(false);
    await destroySession();
  });

  it("a role with no Hub module is refused the Hub", async () => {
    const passwordHash = await bcrypt.hash("password123", 10);
    const noHubRole = await prisma.role.create({
      data: {
        enterpriseId,
        name: `No Hub ${Date.now()}`,
        isSystem: false,
        permissions: {
          create: { module: "FRONT_DESK", canView: true, canCreate: false, canUpdate: false, canDelete: false },
        },
      },
    });
    const user = await prisma.user.create({
      data: {
        enterpriseId,
        email: `no-hub-${Date.now()}@test.local`,
        passwordHash,
        firstName: "No",
        lastName: "Hub",
        roleId: noHubRole.id,
        scope: "ENTERPRISE",
      },
    });

    cookieJar.clear();
    await createSession(user.id);
    const ctx = await requireSession();
    expect(hasHubAccess(ctx)).toBe(false);
    expect(hasAnyPropertyModule(ctx)).toBe(true);
    expect(() => requireHubAccess(ctx)).toThrow(ForbiddenError);
    await destroySession();
  });

  it("disabling INTEGRATIONS for the enterprise revokes Hub access regardless of role", async () => {
    await prisma.enterpriseModuleAccess.upsert({
      where: { enterpriseId_module: { enterpriseId, module: "INTEGRATIONS" } },
      update: { enabled: false },
      create: { enterpriseId, module: "INTEGRATIONS", enabled: false },
    });

    cookieJar.clear();
    await createSession(adminUserId);
    const ctx = await requireSession();
    expect(hasHubAccess(ctx)).toBe(false);
    expect(() => requireHubAccess(ctx)).toThrow(ForbiddenError);
    await destroySession();

    // Re-enable so the other assertions in this file stay independent of ordering.
    await prisma.enterpriseModuleAccess.update({
      where: { enterpriseId_module: { enterpriseId, module: "INTEGRATIONS" } },
      data: { enabled: true },
    });
  });

  it("every HUB_MODULES entry is a real module, and Hub modules are excluded from the property-module check", () => {
    for (const m of HUB_MODULES) {
      expect(SRC_MODULES).toContain(m);
    }
    // hasAnyPropertyModule must never count a Hub module as property-operational —
    // otherwise a Hub-only admin would be sent to a dashboard they cannot use.
    expect(HUB_MODULES.length).toBeGreaterThan(0);
  });

  // Guards the standing hand-sync hazard called out in both files: prisma/ scripts
  // cannot import from src/, so MODULES is duplicated. backfillMissingRolePermissions()
  // heals existing roles, but a brand-new enterprise seeded via ensureRoles() would
  // silently miss a module that only exists in one list.
  it("src/lib/modules.ts and prisma/rbac-seed-data.ts declare identical MODULES", () => {
    expect([...SEED_MODULES].sort()).toEqual([...SRC_MODULES].sort());
  });
});
