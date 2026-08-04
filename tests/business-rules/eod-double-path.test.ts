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

const stepRoute = await import("@/app/api/eod/step/route");
const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BIZ = new Date(Date.UTC(2026, 9, 10)); // 2026-10-10

// A9 regression: the EOD "post" step delegates to night-audit/run, which audits the
// property's CURRENT business date. If a standalone Night Audit already rolled the date
// out-of-band, the EOD post step must NOT audit a fresh night and roll again.
describe("EOD/night-audit double-path guard (A9)", () => {
  let propertyId: string;
  let adminId: string;
  let folioId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "EOD DP", slug: `test-eoddp-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({ data: { enterpriseId: enterprise.id, name: "DP Prop", code: `DP-${uniq()}`, legalName: "DP LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, roomNumber: `D${uniq().slice(-4)}`, status: "CLEAN" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    await customChargeCode(enterprise.id, { code: "1000", description: "Room Revenue" });
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `dp-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "DP", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } });
    adminId = admin.id;
    const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Dp", lastName: "Guest" } });
    const res = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `DP-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(Date.UTC(2026, 9, 8)), checkOutDate: new Date(Date.UTC(2026, 9, 14)), status: "IN_HOUSE", adults: 1,
        assignments: { create: { roomTypeId: rt.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: new Date(Date.UTC(2026, 9, 8)), endDate: new Date(Date.UTC(2026, 9, 14)) } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    folioId = res.folios[0].id;
  });

  it("EOD post step does not re-post/re-roll after a standalone night audit already ran", async () => {
    const runStep = (step: string) =>
      asUser(adminId, () => stepRoute.POST(new Request("http://localhost/api/eod/step", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId, step }),
      })));

    // Start the EOD run (run.businessDate captures BIZ) and complete the steps before
    // "post" so the predecessor check is satisfied — the real wizard order.
    await runStep("start");
    expect((await runStep("departures")).status).toBe(200);
    expect((await runStep("cashier")).status).toBe(200);

    // A standalone Night Audit rolls the date out-of-band: posts BIZ's room night, BIZ -> BIZ+1.
    const standalone = await asUser(adminId, () => nightAuditRunRoute.POST(new Request("http://localhost/api/night-audit/run", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId }),
    })));
    expect(standalone.status).toBe(200);
    expect((await prisma.folioLineItem.count({ where: { folioId, description: "Nightly Room Charge" } }))).toBe(1);
    expect((await prisma.property.findUnique({ where: { id: propertyId } }))!.businessDate!.getTime()).toBe(BIZ.getTime() + 86_400_000);

    // Now the EOD post step for the original run (businessDate BIZ) must detect the date
    // already advanced and skip — no second night posted, no second roll.
    const post = await runStep("post");
    expect(post.status).toBe(200);
    const body = await post.json();
    expect(body.posting?.businessDateAdvanced).toBe(true);

    // Still exactly one room charge, and the date did NOT roll to BIZ+2.
    expect((await prisma.folioLineItem.count({ where: { folioId, description: "Nightly Room Charge" } }))).toBe(1);
    expect((await prisma.property.findUnique({ where: { id: propertyId } }))!.businessDate!.getTime()).toBe(BIZ.getTime() + 86_400_000);
  });
});
