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

const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("End-of-Day 12-hour recency guard", () => {
  let propertyId: string;
  let adminId: string;

  const runEod = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        })
      )
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "EOD Recency", slug: `test-eod-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id, name: "EOD Prop", code: `EOD-${uniq()}`, legalName: "EOD LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
        businessDate: new Date(Date.UTC(2026, 8, 1)),
      },
    });
    propertyId = property.id;
    // A ROOM charge code is required by the audit even with no in-house guests.
    await customChargeCode(enterprise.id, { code: "1000", description: "Room Revenue" });
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `eod-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "EOD", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } });
    adminId = admin.id;
  });

  it("first run succeeds; a re-run within 12h needs confirmation + reason, then proceeds and is logged", async () => {
    const run1 = await runEod({ propertyId });
    expect(run1.status).toBe(200);

    // Second run within 12h, no confirmation → 409 requiresConfirmation.
    const run2 = await runEod({ propertyId });
    expect(run2.status).toBe(409);
    const body2 = await run2.json();
    expect(body2.requiresConfirmation).toBe(true);

    // Confirmed but no reason → 400.
    const run3 = await runEod({ propertyId, confirmed: true });
    expect(run3.status).toBe(400);
    expect((await run3.json()).error).toMatch(/reason/i);

    // Confirmed + reason → proceeds (audits the next business date) and logs the override.
    const run4 = await runEod({ propertyId, confirmed: true, reason: "Reposting after a correction" });
    expect(run4.status).toBe(200);

    const override = await prisma.userActivityLog.findFirst({
      where: { module: "NIGHT_AUDIT", action: "EOD_OVERRIDE", entityId: propertyId },
    });
    expect(override).not.toBeNull();
    expect(override!.description).toMatch(/Reposting after a correction/);
  });
});
