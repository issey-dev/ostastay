import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// src/lib/auth.ts and src/lib/scope.ts call next/headers' cookies(), which only works
// inside a real Next.js request. This in-memory fake lets them run under plain Vitest.
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
  requireEnterpriseId,
  requirePropertyScope,
  requirePermission,
  requireModuleLicensed,
  mintSupportSession,
  clearSupportSession,
  UnauthorizedError,
  ForbiddenError,
} = await import("@/lib/scope");
const { SYSTEM_ROLE_DEFS, SUPPORT_ROLE_DEFS, ensureRoles } = await import("../prisma/rbac-seed-data");

describe("src/lib/scope.ts", () => {
  let enterpriseAId: string;
  let enterpriseBId: string;
  let propertyAId: string;
  let adminAUserId: string;
  let propertyUserId: string;
  let supportUserId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });

    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const supportRoleIds = await ensureRoles(prisma, osta.id, SUPPORT_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-enterprise-a" },
      update: {},
      create: { name: "Enterprise A", slug: "test-enterprise-a", type: "STANDARD" },
    });
    enterpriseAId = enterpriseA.id;
    await prisma.enterpriseLicense.upsert({
      where: { enterpriseId: enterpriseAId },
      update: {},
      create: { enterpriseId: enterpriseAId, tier: "STANDARD", maxProperties: 1 },
    });

    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-enterprise-b" },
      update: {},
      create: { name: "Enterprise B", slug: "test-enterprise-b", type: "STANDARD" },
    });
    enterpriseBId = enterpriseB.id;

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseAId,
        name: "Property A",
        code: `PA-${Date.now()}`,
        legalName: "Property A LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const passwordHash = await bcrypt.hash("password123", 10);

    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseAId,
        email: `admin-a-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "A",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminAUserId = adminA.id;

    const propertyUser = await prisma.user.create({
      data: {
        enterpriseId: enterpriseAId,
        email: `frontdesk-a-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Front",
        lastName: "Desk",
        roleId: roleIds["Front Desk"],
        scope: "PROPERTY",
        propertyId: propertyAId,
      },
    });
    propertyUserId = propertyUser.id;

    const support = await prisma.user.create({
      data: {
        enterpriseId: osta.id,
        email: `support-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Osta",
        lastName: "Support",
        roleId: supportRoleIds["Osta Support Admin"],
        scope: "ENTERPRISE",
      },
    });
    supportUserId = support.id;
  });

  it("requireSession rejects when there is no session cookie", async () => {
    cookieJar.clear();
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireEnterpriseId returns the session's own enterprise, never a client-supplied one", async () => {
    cookieJar.clear();
    await createSession(adminAUserId);
    await expect(requireEnterpriseId()).resolves.toBe(enterpriseAId);
    await destroySession();
  });

  it("requirePermission allows Admin full CONTROLS access and denies Front Desk", async () => {
    cookieJar.clear();
    await createSession(adminAUserId);
    const adminCtx = await requireSession();
    expect(() => requirePermission(adminCtx, "CONTROLS", "update")).not.toThrow();
    await destroySession();

    cookieJar.clear();
    await createSession(propertyUserId);
    const frontDeskCtx = await requireSession();
    expect(() => requirePermission(frontDeskCtx, "CONTROLS", "view")).toThrow(ForbiddenError);
    await destroySession();
  });

  it("requirePropertyScope rejects a PROPERTY-scoped user accessing a different property", async () => {
    cookieJar.clear();
    await createSession(propertyUserId);
    const ctx = await requireSession();
    expect(() => requirePropertyScope(ctx, propertyAId)).not.toThrow();
    expect(() => requirePropertyScope(ctx, "some-other-property-id")).toThrow(ForbiddenError);
    await destroySession();
  });

  it("requireModuleLicensed fails open when no TierModuleAccess row exists (scaffold, not real enforcement)", async () => {
    await expect(requireModuleLicensed(enterpriseAId, "POS")).resolves.toBeUndefined();

    await prisma.tierModuleAccess.upsert({
      where: { tier_module: { tier: "STANDARD", module: "POS" } },
      update: { enabled: false },
      create: { tier: "STANDARD", module: "POS", enabled: false },
    });
    await expect(requireModuleLicensed(enterpriseAId, "POS")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("support access: an Osta session with no grant stays scoped to Osta's own enterprise", async () => {
    cookieJar.clear();
    await createSession(supportUserId);
    const ctx = await requireSession();
    expect(ctx.isInternal).toBe(true);
    expect(ctx.isActingAsSupport).toBe(false);
    expect(ctx.enterpriseId).not.toBe(enterpriseBId);
    await destroySession();
  });

  it("support access: an APPROVED grant lets the Osta user act as the target enterprise, and a revoked grant is rejected live on the next request", async () => {
    const grant = await prisma.supportAccessGrant.create({
      data: {
        enterpriseId: enterpriseBId,
        requestedByUserId: supportUserId,
        approvedByUserId: adminAUserId,
        status: "APPROVED",
        respondedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    cookieJar.clear();
    await createSession(supportUserId);
    await mintSupportSession(supportUserId, enterpriseBId, grant.id, grant.expiresAt);

    const activeCtx = await requireSession();
    expect(activeCtx.isActingAsSupport).toBe(true);
    expect(activeCtx.enterpriseId).toBe(enterpriseBId);
    expect(activeCtx.homeEnterpriseId).not.toBe(enterpriseBId);

    await prisma.supportAccessGrant.update({ where: { id: grant.id }, data: { status: "REVOKED" } });

    await expect(requireSession()).rejects.toBeInstanceOf(ForbiddenError);
    // The revoked grant must clear the acting-as cookie, not silently fall back.
    expect(cookieJar.has("support_session")).toBe(false);

    await destroySession();
  });

  it("requireSession backfills a System role's missing RolePermission row for a module added after it was seeded, using that role's canonical default", async () => {
    // Simulates the real bug: an "Admin" role row that predates DEBTORS being added
    // to MODULES — every module except DEBTORS has a row, exactly like an
    // already-seeded enterprise's Admin role would look after a code deploy adds a
    // module. ensureRoles()'s upsert would never touch this on its own. A fresh
    // enterprise (not enterpriseAId, which already has its own "Admin" role from
    // beforeAll — @@unique([enterpriseId, name]) would collide) with a role named
    // exactly "Admin" so the backfill's name-keyed lookup into SYSTEM_ROLE_DEFS matches.
    const legacyEnterprise = await prisma.enterprise.create({
      data: { name: `Legacy Enterprise ${Date.now()}`, slug: `test-legacy-${Date.now()}`, type: "STANDARD" },
    });
    const legacyAdminRole = await prisma.role.create({
      data: {
        enterpriseId: legacyEnterprise.id,
        name: "Admin",
        isSystem: true,
        permissions: {
          create: (Object.keys(SYSTEM_ROLE_DEFS.Admin) as Array<keyof typeof SYSTEM_ROLE_DEFS.Admin>)
            .filter((m) => m !== "DEBTORS")
            .map((module) => ({ module, ...SYSTEM_ROLE_DEFS.Admin[module] })),
        },
      },
    });
    expect(await prisma.rolePermission.count({ where: { roleId: legacyAdminRole.id, module: "DEBTORS" } })).toBe(0);

    const passwordHash = await bcrypt.hash("password123", 10);
    const legacyAdminUser = await prisma.user.create({
      data: {
        enterpriseId: legacyEnterprise.id,
        email: `legacy-admin-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Legacy",
        lastName: "Admin",
        roleId: legacyAdminRole.id,
        scope: "ENTERPRISE",
      },
    });

    cookieJar.clear();
    await createSession(legacyAdminUser.id);
    const ctx = await requireSession();
    // Admin's canonical default for DEBTORS is FULL — the backfilled row must match
    // it, not just be present.
    expect(ctx.permissions.get("DEBTORS")).toEqual(SYSTEM_ROLE_DEFS.Admin.DEBTORS);
    expect(() => requirePermission(ctx, "DEBTORS", "delete")).not.toThrow();
    await destroySession();

    const backfilled = await prisma.rolePermission.findUnique({
      where: { roleId_module: { roleId: legacyAdminRole.id, module: "DEBTORS" } },
    });
    expect(backfilled).toMatchObject(SYSTEM_ROLE_DEFS.Admin.DEBTORS);

    // A second request for the same role must not error or duplicate the row —
    // RolePermission's @@unique([roleId, module]) plus the upsert-based backfill
    // makes this idempotent.
    cookieJar.clear();
    await createSession(legacyAdminUser.id);
    await expect(requireSession()).resolves.toBeTruthy();
    await destroySession();
    expect(await prisma.rolePermission.count({ where: { roleId: legacyAdminRole.id, module: "DEBTORS" } })).toBe(1);
  });

  it("requireSession backfills a custom (non-system) role's missing module with NO_ACCESS, not the System default", async () => {
    const customRole = await prisma.role.create({
      data: {
        enterpriseId: enterpriseAId,
        name: `Custom Role ${Date.now()}`,
        isSystem: false,
        permissions: { create: { module: "FRONT_DESK", canView: true, canCreate: false, canUpdate: false, canDelete: false } },
      },
    });

    const passwordHash = await bcrypt.hash("password123", 10);
    const customUser = await prisma.user.create({
      data: {
        enterpriseId: enterpriseAId,
        email: `custom-role-${Date.now()}@test.local`,
        passwordHash,
        firstName: "Custom",
        lastName: "Role",
        roleId: customRole.id,
        scope: "ENTERPRISE",
      },
    });

    cookieJar.clear();
    await createSession(customUser.id);
    const ctx = await requireSession();
    expect(ctx.permissions.get("DEBTORS")).toEqual({ canView: false, canCreate: false, canUpdate: false, canDelete: false });
    expect(() => requirePermission(ctx, "DEBTORS", "view")).toThrow(ForbiddenError);
    await destroySession();
  });
});
