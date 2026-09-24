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
const {
  requireSession,
  requireEnterpriseHub,
  requirePropertySetup,
  hasHubAccess,
  hasEnterpriseHubAccess,
  canSetUpProperty,
  hasAnyPropertyModule,
  HUB_MODULES,
  PROPERTY_SETUP_MODULES,
  ENTERPRISE_ONLY_MODULES,
  ForbiddenError,
} = await import("@/lib/scope");
const { MODULES: SRC_MODULES } = await import("@/lib/modules");
const {
  MODULES: SEED_MODULES,
  SYSTEM_ROLE_DEFS,
  ensureRoles,
} = await import("../../prisma/rbac-seed-data");

// The Hub (src/app/e/[slug]/hub) holds all setup and administration, and deliberately
// contains NO PMS functionality. Since 2026-09-23 it has two areas — see
// .agents/docs/HUB_SETUP_PLAN.md:
//   ENTERPRISE  shared settings — never reachable by a single-property user
//   PROPERTY    one property's setup — a single-property user reaches their own only
describe("Hub access (enterprise and property areas)", () => {
  let enterpriseId: string;
  let propertyId: string;
  let otherPropertyId: string;
  let adminUserId: string;
  let hubOnlyUserId: string;
  let propertyScopedHubUserId: string;
  let controlsOnlyUserId: string;
  let propertyUsersOnlyUserId: string;
  let passwordHash: string;

  async function roleWith(name: string, module: string) {
    return prisma.role.create({
      data: {
        enterpriseId,
        name: `${name} ${Date.now()}-${Math.random()}`,
        isSystem: false,
        permissions: {
          create: { module, canView: true, canCreate: true, canUpdate: true, canDelete: true },
        },
      },
    });
  }

  async function userWith(
    label: string,
    roleId: string,
    scope: "ENTERPRISE" | "PROPERTY",
    pinnedPropertyId: string | null = null
  ) {
    return prisma.user.create({
      data: {
        enterpriseId,
        email: `${label}-${Date.now()}-${Math.random()}@test.local`,
        passwordHash,
        firstName: label,
        lastName: "Test",
        roles: { create: { roleId } },
        scope,
        propertyId: pinnedPropertyId,
      },
    });
  }

  async function makeProperty(name: string) {
    return prisma.property.create({
      data: {
        enterpriseId,
        name,
        code: `HP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        legalName: `${name} LLC`,
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
  }

  async function sessionFor(userId: string) {
    cookieJar.clear();
    await createSession(userId);
    return requireSession();
  }

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
      data: { enterpriseId, tier: "STANDARD", maxProperties: 2 },
    });

    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    propertyId = (await makeProperty("Hub Property")).id;
    otherPropertyId = (await makeProperty("Hub Property Two")).id;
    passwordHash = await bcrypt.hash("password123", 10);

    // A normal Admin: holds every module — the enterprise area and every property.
    adminUserId = (await userWith("admin", roleIds["Admin"], "ENTERPRISE")).id;

    // The Hub-only administrator shape (decision D-3): an ENTERPRISE-scoped user whose
    // role grants ONLY a Hub module and nothing operational.
    hubOnlyUserId = (await userWith("hub-only", (await roleWith("Hub Only", "INTEGRATIONS")).id, "ENTERPRISE")).id;

    // A single-property user granted INTEGRATIONS: may enter the Hub, but only for their
    // own property — never the enterprise area (that block is on scope, not on the
    // permission bit).
    propertyScopedHubUserId = (
      await userWith("property-hub", (await roleWith("Property Hub", "INTEGRATIONS")).id, "PROPERTY", propertyId)
    ).id;

    // An All-Properties user holding ONLY Property Setup — the Controls page is gone
    // from the dashboard, so this user belongs in the Hub.
    controlsOnlyUserId = (await userWith("setup-only", (await roleWith("Setup Only", "CONTROLS")).id, "ENTERPRISE")).id;

    // A single-property user whose role grants ONLY Users & Access — enterprise-only, so
    // it opens nothing for them.
    propertyUsersOnlyUserId = (
      await userWith("property-users", (await roleWith("Users Only", "USERS")).id, "PROPERTY", propertyId)
    ).id;
  });

  it("an Admin reaches the enterprise area and every property's setup", async () => {
    const ctx = await sessionFor(adminUserId);
    expect(hasHubAccess(ctx)).toBe(true);
    expect(hasEnterpriseHubAccess(ctx)).toBe(true);
    expect(hasAnyPropertyModule(ctx)).toBe(true);
    expect(() => requireEnterpriseHub(ctx)).not.toThrow();
    expect(canSetUpProperty(ctx, { id: propertyId, enterpriseId })).toBe(true);
    expect(canSetUpProperty(ctx, { id: otherPropertyId, enterpriseId })).toBe(true);
    await expect(requirePropertySetup(ctx, otherPropertyId, "CONTROLS", "update")).resolves.toBeUndefined();
    await destroySession();
  });

  it("a single-property user with INTEGRATIONS enters the Hub for their own property only", async () => {
    const ctx = await sessionFor(propertyScopedHubUserId);
    // The permission bit really is granted — proving the refusals below come from scope.
    expect(ctx.permissions.get("INTEGRATIONS")?.canView).toBe(true);
    expect(ctx.scope).toBe("PROPERTY");

    expect(hasHubAccess(ctx)).toBe(true);
    // The enterprise area is refused outright, whatever the role grants.
    expect(hasEnterpriseHubAccess(ctx)).toBe(false);
    expect(() => requireEnterpriseHub(ctx)).toThrow(ForbiddenError);

    // Own property: yes. Another property of the same enterprise: no.
    expect(canSetUpProperty(ctx, { id: propertyId, enterpriseId })).toBe(true);
    expect(canSetUpProperty(ctx, { id: otherPropertyId, enterpriseId })).toBe(false);
    await expect(requirePropertySetup(ctx, propertyId, "INTEGRATIONS", "view")).resolves.toBeUndefined();
    await expect(requirePropertySetup(ctx, otherPropertyId, "INTEGRATIONS", "view")).rejects.toThrow(ForbiddenError);
    // Holding INTEGRATIONS is not holding Property Setup.
    await expect(requirePropertySetup(ctx, propertyId, "CONTROLS", "view")).rejects.toThrow(ForbiddenError);
    await destroySession();
  });

  it("a single-property user holding only an enterprise-only module is refused the Hub", async () => {
    const ctx = await sessionFor(propertyUsersOnlyUserId);
    expect(ctx.permissions.get("USERS")?.canView).toBe(true);
    expect(hasHubAccess(ctx)).toBe(false);
    expect(hasEnterpriseHubAccess(ctx)).toBe(false);
    await destroySession();
  });

  it("an All-Properties user with only Property Setup lands in the Hub", async () => {
    const ctx = await sessionFor(controlsOnlyUserId);
    expect(hasHubAccess(ctx)).toBe(true);
    // Property Setup is a Hub module now — this is what sends the user to /hub instead
    // of a dashboard with nothing on it (src/app/e/[slug]/dashboard/page.tsx).
    expect(hasAnyPropertyModule(ctx)).toBe(false);
    expect(canSetUpProperty(ctx, { id: otherPropertyId, enterpriseId })).toBe(true);
    await destroySession();
  });

  it("a Hub-only administrator has Hub access but no property-operational module", async () => {
    const ctx = await sessionFor(hubOnlyUserId);
    expect(hasHubAccess(ctx)).toBe(true);
    // This is what routes the user to /hub instead of a dead property page — see
    // src/app/e/[slug]/dashboard/page.tsx.
    expect(hasAnyPropertyModule(ctx)).toBe(false);
    await destroySession();
  });

  it("never lets a property of another enterprise be set up", async () => {
    const ctx = await sessionFor(adminUserId);
    expect(canSetUpProperty(ctx, { id: propertyId, enterpriseId: "some-other-enterprise" })).toBe(false);
    await destroySession();
  });

  it("a role with no Hub module is refused the Hub", async () => {
    const user = await userWith("no-hub", (await roleWith("No Hub", "FRONT_DESK")).id, "ENTERPRISE");
    const ctx = await sessionFor(user.id);
    expect(hasHubAccess(ctx)).toBe(false);
    expect(hasAnyPropertyModule(ctx)).toBe(true);
    expect(() => requireEnterpriseHub(ctx)).toThrow(ForbiddenError);
    await destroySession();
  });

  it("every HUB_MODULES entry is a real module, split exactly into property-setup and enterprise-only", () => {
    for (const m of HUB_MODULES) {
      expect(SRC_MODULES).toContain(m);
    }
    // Every Hub module is either reachable per property or enterprise-only — never both,
    // never neither — so no permission can fall between the two areas.
    expect([...PROPERTY_SETUP_MODULES, ...ENTERPRISE_ONLY_MODULES].sort()).toEqual([...HUB_MODULES].sort());
  });

  // Guards the standing hand-sync hazard called out in both files: prisma/ scripts
  // cannot import from src/, so MODULES is duplicated. backfillMissingRolePermissions()
  // heals existing roles, but a brand-new enterprise seeded via ensureRoles() would
  // silently miss a module that only exists in one list.
  it("src/lib/modules.ts and prisma/rbac-seed-data.ts declare identical MODULES", () => {
    expect([...SEED_MODULES].sort()).toEqual([...SRC_MODULES].sort());
  });
});
