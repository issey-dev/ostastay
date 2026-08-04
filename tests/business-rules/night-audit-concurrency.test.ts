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
const BIZ = new Date(Date.UTC(2026, 8, 20)); // 2026-09-20

// A1 regression: the Night Audit run route must be idempotent under concurrency. Before
// the atomic claim, two near-simultaneous runs both read the "already run?" guard as null
// and both posted every charge + rolled the business date twice. The claim is a single
// IN_PROGRESS row guarded by @@unique([propertyId, auditDate]); only one run can win it.
describe("Night Audit concurrency — no double-post, no double-roll (A1)", () => {
  let propertyId: string;
  let adminId: string;
  let folioId: string;

  const runAudit = () =>
    asUser(adminId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId }),
        })
      )
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "NA Concurrency", slug: `test-nac-${uniq()}`, type: "STANDARD" } });
    const property = await prisma.property.create({ data: { enterpriseId: enterprise.id, name: "NAC Prop", code: `NAC-${uniq()}`, legalName: "NAC LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, roomNumber: `N${uniq().slice(-4)}`, status: "CLEAN" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    await customChargeCode(enterprise.id, { code: "1000", description: "Room Revenue" });
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `nac-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "NAC", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } });
    adminId = admin.id;
    const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Nac", lastName: "Guest" } });
    const chargeable = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `NAC-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(Date.UTC(2026, 8, 18)), checkOutDate: new Date(Date.UTC(2026, 8, 22)), status: "IN_HOUSE", adults: 1,
        assignments: { create: { roomTypeId: rt.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: new Date(Date.UTC(2026, 8, 18)), endDate: new Date(Date.UTC(2026, 8, 22)) } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    folioId = chargeable.folios[0].id;
  });

  it("two concurrent runs post the room charge once and roll the date exactly one day", async () => {
    const [a, b] = await Promise.all([runAudit(), runAudit()]);

    // Exactly one run wins (200); the other is rejected — cleanly (409 from the claim) or
    // via a rolled-back DB-lock error under SQLite. Either way it must not post/roll twice.
    const okCount = [a, b].filter((r) => r.status === 200).length;
    expect(okCount).toBe(1);

    // The nightly room charge posted exactly once — not twice.
    const lines = await prisma.folioLineItem.findMany({ where: { folioId, description: "Nightly Room Charge" } });
    expect(lines.length).toBe(1);
    expect(lines[0].amount).toBe(100);

    // The business date advanced by exactly one day, not two.
    const prop = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(prop!.businessDate!.getTime()).toBe(BIZ.getTime() + 86_400_000);

    // Exactly one COMPLETED audit log for the audited date.
    const completed = await prisma.propertyNightAuditLog.findMany({ where: { propertyId, auditDate: BIZ, status: "COMPLETED" } });
    expect(completed.length).toBe(1);
  });
});
