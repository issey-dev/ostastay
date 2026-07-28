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
const { requireSession, EodLockoutError } = await import("@/lib/scope");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");

const eodStatusRoute = await import("@/app/api/session/eod-status/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

// The watermark comparison is `token.iat < eodSessionsInvalidAt`, and `iat` only has
// one-second resolution — so a watermark set in the same second as the token would not
// trip. Every test sets it a minute out to represent "the roll happened after login".
const AFTER_LOGIN = () => new Date(Date.now() + 60_000);

async function asUser<T>(userId: string, currentPropertyId: string | null, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  if (currentPropertyId) cookieJar.set("current_property_id", currentPropertyId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("End-of-Day force logout is keyed on the session's working property", () => {
  let enterpriseId: string;
  let rolledPropertyId: string;
  let otherPropertyId: string;
  let enterpriseAdminId: string;
  let propertyStaffId: string;
  let otherPropertyStaffId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "EOD Logout Test", slug: `test-eod-logout-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    // The property that runs EOD, and a second one in the same enterprise that doesn't —
    // the second is what proves the lockout is scoped to a location, not the enterprise.
    const propertyDefaults = {
      legalName: "EOD Logout Test Ltd", defaultCurrency: "USD", timeZone: "UTC",
      checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE",
    };
    const rolled = await prisma.property.create({
      data: { enterpriseId, name: "Rolled Property", code: `RLD${uniq().slice(-4)}`, ...propertyDefaults },
    });
    rolledPropertyId = rolled.id;
    const other = await prisma.property.create({
      data: { enterpriseId, name: "Other Property", code: `OTH${uniq().slice(-4)}`, ...propertyDefaults },
    });
    otherPropertyId = other.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const mk = (email: string, scope: string, propertyId: string | null) =>
      prisma.user.create({
        data: {
          enterpriseId, email, passwordHash, firstName: "EOD", lastName: "User",
          roleId: roleIds["Admin"], scope, propertyId,
        },
      });

    enterpriseAdminId = (await mk(`eod-ent-${uniq()}@test.local`, "ENTERPRISE", null)).id;
    propertyStaffId = (await mk(`eod-prop-${uniq()}@test.local`, "PROPERTY", rolledPropertyId)).id;
    otherPropertyStaffId = (await mk(`eod-other-${uniq()}@test.local`, "PROPERTY", otherPropertyId)).id;
  });

  it("signs out a PROPERTY-scoped user bound to the rolled property", async () => {
    await prisma.property.update({
      where: { id: rolledPropertyId },
      data: { eodSessionsInvalidAt: AFTER_LOGIN() },
    });

    await asUser(propertyStaffId, null, async () => {
      await expect(requireSession()).rejects.toBeInstanceOf(EodLockoutError);
    });
  });

  it("signs out an ENTERPRISE-scoped user who has the rolled property selected", async () => {
    await prisma.property.update({
      where: { id: rolledPropertyId },
      data: { eodSessionsInvalidAt: AFTER_LOGIN() },
    });

    // This is the case the old PROPERTY-only rule missed: an enterprise admin working
    // in the property that just closed kept their session and a stale business date.
    await asUser(enterpriseAdminId, rolledPropertyId, async () => {
      await expect(requireSession()).rejects.toBeInstanceOf(EodLockoutError);
    });
  });

  it("leaves the same ENTERPRISE-scoped user alone while they're in another property", async () => {
    await prisma.property.update({
      where: { id: rolledPropertyId },
      data: { eodSessionsInvalidAt: AFTER_LOGIN() },
    });

    await asUser(enterpriseAdminId, otherPropertyId, async () => {
      const ctx = await requireSession();
      expect(ctx.sessionPropertyId).toBe(otherPropertyId);
    });
  });

  it("leaves staff of an un-rolled property alone", async () => {
    await prisma.property.update({
      where: { id: rolledPropertyId },
      data: { eodSessionsInvalidAt: AFTER_LOGIN() },
    });

    await asUser(otherPropertyStaffId, null, async () => {
      const ctx = await requireSession();
      expect(ctx.sessionPropertyId).toBe(otherPropertyId);
    });
  });

  it("lets a session back in once it signs in after the roll", async () => {
    // Watermark in the past: a token issued now is newer, i.e. a fresh login.
    await prisma.property.update({
      where: { id: rolledPropertyId },
      data: { eodSessionsInvalidAt: new Date(Date.now() - 60_000) },
    });

    await asUser(propertyStaffId, null, async () => {
      const ctx = await requireSession();
      expect(ctx.sessionPropertyId).toBe(rolledPropertyId);
    });
  });

  it("eod-status stays reachable through the lockout and reports it", async () => {
    await prisma.property.update({
      where: { id: rolledPropertyId },
      data: { eodSessionsInvalidAt: AFTER_LOGIN() },
    });

    // Every other route 401s here; this one must answer, or the browser can never
    // explain to the user why they're being signed out.
    const res = await asUser(enterpriseAdminId, rolledPropertyId, () => eodStatusRoute.GET());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forcedLogout).toBe(true);
    expect(body.propertyName).toBe("Rolled Property");
  });

  it("eod-status reports an in-progress roll before the lockout lands", async () => {
    await prisma.property.update({
      where: { id: rolledPropertyId },
      data: { eodSessionsInvalidAt: null },
    });
    const businessDate = new Date(Date.UTC(2026, 7, 1));
    await prisma.eodRun.upsert({
      where: { propertyId_businessDate: { propertyId: rolledPropertyId, businessDate } },
      update: { status: "IN_PROGRESS" },
      create: {
        propertyId: rolledPropertyId, businessDate, status: "IN_PROGRESS",
        startedByUserId: enterpriseAdminId,
      },
    });

    const res = await asUser(enterpriseAdminId, rolledPropertyId, () => eodStatusRoute.GET());
    const body = await res.json();
    expect(body.eodInProgress).toBe(true);
    expect(body.forcedLogout).toBe(false);
  });
});
