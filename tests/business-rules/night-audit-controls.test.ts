import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Night Audit controls (Hub > the property > Night Audit): WHEN a never-arrived reservation
// becomes a No-Show and whether its fee is posted (PropertySettings.noShowTiming /
// noShowPostFee), and the scheduled audit that runs End-of-Day with no one at the desk
// (src/lib/night-audit/scheduled.ts).

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
const { customChargeCode } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");
const runRoute = await import("@/app/api/night-audit/run/route");
const { minutesPastAuditTime, propertyLocalNow, runScheduledAudits } = await import("@/lib/night-audit/scheduled");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

describe("Night Audit controls", () => {
  let enterpriseId: string;
  let adminId: string;
  let guestId: string;

  // A charted, untaxed property on business date 2026-09-10 with one room type.
  async function makeProperty(name: string, timeZone = "UTC") {
    const property = await prisma.property.create({
      data: {
        enterpriseId, name, code: `NA-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone,
        checkInTime: "14:00", checkOutTime: "11:00", businessDate: D("2026-09-10"),
      },
    });
    await customChargeCode({ propertyId: property.id }, { code: "1000", description: "Room Revenue" });
    await setPropertySettings(property.id, { tgstEnabled: false, serviceChargeEnabled: false, greenTaxEnabled: false });
    const roomType = await prisma.roomType.create({ data: { propertyId: property.id, name: "Std", code: "STD", maxOccupancy: 2 } });
    return { id: property.id, roomTypeId: roomType.id };
  }

  const arrival = (propertyId: string, checkIn: string) =>
    prisma.reservation.create({
      data: { propertyId, primaryGuestId: guestId, confirmationNo: `NA${uniq()}`, status: "RESERVED", checkInDate: D(checkIn), checkOutDate: D("2026-09-20") },
    });

  const audit = (propertyId: string) =>
    asUser(adminId, () =>
      runRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId, confirmed: true, reason: "test" }),
      }))
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    enterpriseId = (await prisma.enterprise.create({ data: { name: "NA", slug: `test-na-${uniq()}`, type: "STANDARD" } })).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({
      data: { enterpriseId, email: `na-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Late", lastName: "Guest" } })).upid;
  });

  describe("no-shows", () => {
    it("marks tonight's non-arrival at tonight's audit by default", async () => {
      const p = await makeProperty("FirstAudit");
      const r = await arrival(p.id, "2026-09-10");
      expect((await audit(p.id)).status).toBe(200);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("NO_SHOW");
    });

    it("holds a late arrival one night, then marks it at the next audit", async () => {
      const p = await makeProperty("SecondAudit");
      await setPropertySettings(p.id, { noShowTiming: "SECOND_AUDIT" });
      const r = await arrival(p.id, "2026-09-10");

      const first = await audit(p.id);
      const body = await first.json();
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("RESERVED");
      expect(body.heldArrivalConfirmationNos).toContain(r.confirmationNo);

      // The next night (business date is now 2026-09-11): still not arrived — marked.
      expect((await audit(p.id)).status).toBe(200);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("NO_SHOW");
    });

    it("never marks automatically when the desk decides", async () => {
      const p = await makeProperty("Manual");
      await setPropertySettings(p.id, { noShowTiming: "MANUAL" });
      const r = await arrival(p.id, "2026-09-10");
      const body = await (await audit(p.id)).json();
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("RESERVED");
      expect(body.heldArrivalsWarning).toContain("front desk");
    });

    it("marks the no-show but posts no fee when the fee switch is off", async () => {
      const p = await makeProperty("NoFee");
      await setPropertySettings(p.id, { noShowPostFee: false });
      const feeCode = await customChargeCode({ propertyId: p.id }, { code: "NSF", description: "No-show fee" });
      const rule = await prisma.propertyFeeRule.create({
        data: { propertyId: p.id, name: "One night", ruleType: "NO_SHOW", basis: "FLAT", value: 50, chargeCodeId: feeCode.id, isActive: true },
      });
      const r = await prisma.reservation.create({
        data: {
          propertyId: p.id, primaryGuestId: guestId, confirmationNo: `NA${uniq()}`, status: "RESERVED",
          checkInDate: D("2026-09-10"), checkOutDate: D("2026-09-12"), noShowFeeRuleId: rule.id,
        },
      });
      expect((await audit(p.id)).status).toBe(200);
      expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("NO_SHOW");
      expect(await prisma.folioLineItem.count({ where: { folio: { reservationId: r.id } } })).toBe(0);
    });
  });

  describe("scheduled audit", () => {
    it("works out when an audit is due, in the property's own time zone", () => {
      const bd = D("2026-09-10");
      // 02:00 closes the day before: due at 2026-09-11 02:00 local.
      expect(minutesPastAuditTime(bd, "02:00", { date: D("2026-09-11"), minutes: 60 })).toBe(-60);
      expect(minutesPastAuditTime(bd, "02:00", { date: D("2026-09-11"), minutes: 150 })).toBe(30);
      // 23:30 closes the same day.
      expect(minutesPastAuditTime(bd, "23:30", { date: D("2026-09-10"), minutes: 23 * 60 + 45 })).toBe(15);
      // Maldives is UTC+5: 21:30 UTC on the 10th is 02:30 on the 11th there.
      const local = propertyLocalNow("Indian/Maldives", new Date("2026-09-10T21:30:00Z"));
      expect(local.date.toISOString().slice(0, 10)).toBe("2026-09-11");
      expect(local.minutes).toBe(150);
    });

    it("runs the whole End-of-Day when due, and leaves it alone before then", async () => {
      const p = await makeProperty("Scheduled", "Indian/Maldives");
      await setPropertySettings(p.id, { autoAuditEnabled: true, autoAuditTime: "02:00" });

      // 01:00 Maldives on the 11th — not yet.
      await runScheduledAudits(enterpriseId, new Date("2026-09-10T20:00:00Z"));
      expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).businessDate?.toISOString().slice(0, 10)).toBe("2026-09-10");

      // 02:30 Maldives — due: every step runs and the date rolls.
      const result = await runScheduledAudits(enterpriseId, new Date("2026-09-10T21:30:00Z"));
      expect(result.summary).toContain("audited 2026-09-10");
      expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).businessDate?.toISOString().slice(0, 10)).toBe("2026-09-11");
      const run = await prisma.eodRun.findFirstOrThrow({ where: { propertyId: p.id } });
      expect(run.status).toBe("COMPLETED");
      await setPropertySettings(p.id, { autoAuditEnabled: false });
    });

    it("stops at a step that needs a person, and fails so the Overview shows it", async () => {
      const p = await makeProperty("Blocked");
      await setPropertySettings(p.id, { autoAuditEnabled: true, autoAuditTime: "02:00" });
      // A guest still due out: the departures step needs a person.
      await prisma.reservation.create({
        data: { propertyId: p.id, primaryGuestId: guestId, confirmationNo: `NA${uniq()}`, status: "IN_HOUSE", checkInDate: D("2026-09-08"), checkOutDate: D("2026-09-10") },
      });
      await expect(runScheduledAudits(enterpriseId, new Date("2026-09-11T02:30:00Z"))).rejects.toThrow(/Blocked: stopped at "Resolve departures"/);
      expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).businessDate?.toISOString().slice(0, 10)).toBe("2026-09-10");
      await setPropertySettings(p.id, { autoAuditEnabled: false });
    });

    it("does not catch up a property more than a day behind — it reports it", async () => {
      const p = await makeProperty("Behind");
      await setPropertySettings(p.id, { autoAuditEnabled: true, autoAuditTime: "02:00" });
      await expect(runScheduledAudits(enterpriseId, new Date("2026-09-14T03:00:00Z"))).rejects.toThrow(/Behind: business date 2026-09-10 is more than a day behind/);
      expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).businessDate?.toISOString().slice(0, 10)).toBe("2026-09-10");
      await setPropertySettings(p.id, { autoAuditEnabled: false });
    });
  });
});
