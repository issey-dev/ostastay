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
const stepRoute = await import("@/app/api/eod/step/route");
const settingsRoute = await import("@/app/api/properties/[id]/settings/route");
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

  describe("checking out settled departures", () => {
    // A guest due out tonight, in a room, with one folio: settled (nothing on it), owing
    // (a charge, no payment) or settling by City Ledger.
    async function dueOut(p: { id: string; roomTypeId: string }, kind: "settled" | "owing" | "ledger") {
      const ratePlan = await prisma.ratePlan.upsert({
        where: { propertyId_code: { propertyId: p.id, code: "BAR" } },
        update: {},
        create: { propertyId: p.id, code: "BAR", name: "BAR" },
      });
      const room = await prisma.room.create({ data: { propertyId: p.id, roomTypeId: p.roomTypeId, roomNumber: `R${uniq().slice(-6)}`, status: "CLEAN" } });
      const r = await prisma.reservation.create({
        data: {
          propertyId: p.id, primaryGuestId: guestId, confirmationNo: `NA${uniq()}`, status: "IN_HOUSE",
          checkInDate: D("2026-09-08"), checkOutDate: D("2026-09-10"),
          assignments: { create: { roomTypeId: p.roomTypeId, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: D("2026-09-08"), endDate: D("2026-09-10") } },
          folios: { create: { folioNumber: 1, propertyId: p.id, settlementMethod: kind === "ledger" ? "CITY_LEDGER" : undefined } },
        },
        include: { folios: true },
      });
      if (kind === "owing") {
        const code = await prisma.chargeCode.findUniqueOrThrow({ where: { propertyId_code: { propertyId: p.id, code: "1000" } } });
        await prisma.folioLineItem.create({ data: { folioId: r.folios[0].id, chargeCodeId: code.id, date: D("2026-09-09"), description: "Room", amount: 100 } });
      }
      return r;
    }
    const status = async (id: string) => (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;

    it("checks out the settled guest and stops only for the one who still owes, or settles by City Ledger", async () => {
      const p = await makeProperty("AutoCheckOut");
      await setPropertySettings(p.id, { autoCheckOutZeroBalance: true, autoAuditEnabled: true, autoAuditTime: "02:00" });
      const settled = await dueOut(p, "settled");
      const owing = await dueOut(p, "owing");
      const ledger = await dueOut(p, "ledger");

      await expect(runScheduledAudits(enterpriseId, new Date("2026-09-11T02:30:00Z"))).rejects.toThrow(
        /1 settled guest was checked out automatically; 2 guests are still due out/
      );
      expect(await status(settled.id)).toBe("CHECKED_OUT");
      expect(await status(owing.id)).toBe("IN_HOUSE");
      expect(await status(ledger.id)).toBe("IN_HOUSE");
      await setPropertySettings(p.id, { autoAuditEnabled: false });
    });

    it("completes the whole audit when every departure is settled", async () => {
      const p = await makeProperty("AllSettled");
      await setPropertySettings(p.id, { autoCheckOutZeroBalance: true, autoAuditEnabled: true, autoAuditTime: "02:00" });
      const settled = await dueOut(p, "settled");
      const result = await runScheduledAudits(enterpriseId, new Date("2026-09-11T02:30:00Z"));
      expect(result.summary).toContain("AllSettled: audited 2026-09-10");
      expect(await status(settled.id)).toBe("CHECKED_OUT");
      await setPropertySettings(p.id, { autoAuditEnabled: false });
    });

    it("leaves every departure to the desk when the setting is off", async () => {
      const p = await makeProperty("DeskDecides");
      await setPropertySettings(p.id, { autoAuditEnabled: true, autoAuditTime: "02:00" });
      const settled = await dueOut(p, "settled");
      await expect(runScheduledAudits(enterpriseId, new Date("2026-09-11T02:30:00Z"))).rejects.toThrow(/DeskDecides: stopped at "Resolve departures": 1 guest is still due out/);
      expect(await status(settled.id)).toBe("IN_HOUSE");
      await setPropertySettings(p.id, { autoAuditEnabled: false });
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

    it("only accepts an audit time between 22:00 and 06:00", async () => {
      const p = await makeProperty("Window");
      const save = (autoAuditTime: string) =>
        asUser(adminId, () =>
          settingsRoute.PATCH(
            new Request(`http://localhost/api/properties/${p.id}/settings`, {
              method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoAuditTime }),
            }),
            { params: Promise.resolve({ id: p.id }) }
          )
        );
      for (const ok of ["22:00", "23:59", "00:00", "02:00", "06:00"]) expect((await save(ok)).status).toBe(200);
      for (const bad of ["06:01", "12:00", "18:30", "21:59"]) {
        const res = await save(bad);
        expect(res.status).toBe(400);
        expect((await res.json()).error).toContain("between 22:00 and 06:00");
      }
    });

    it("refuses a stored time outside 22:00–06:00 instead of rolling the date mid-day", async () => {
      const p = await makeProperty("OutOfWindow");
      // Saved before the rule existed — written straight to the table.
      await setPropertySettings(p.id, { autoAuditEnabled: true, autoAuditTime: "14:00" });
      await expect(runScheduledAudits(enterpriseId, new Date("2026-09-10T15:00:00Z"))).rejects.toThrow(
        /OutOfWindow: scheduled time 14:00 is outside 22:00–06:00 — set a new time/
      );
      expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).businessDate?.toISOString().slice(0, 10)).toBe("2026-09-10");
      await setPropertySettings(p.id, { autoAuditEnabled: false });
    });

    it("stops at an open cashier shift — only a person's Night Audit force-closes it", async () => {
      const p = await makeProperty("OpenDrawer");
      await setPropertySettings(p.id, { autoAuditEnabled: true, autoAuditTime: "02:00" });
      const shift = await prisma.cashierShift.create({ data: { enterpriseId, userId: adminId, propertyId: p.id, businessDate: D("2026-09-10"), openingFloat: 200 } });

      await expect(runScheduledAudits(enterpriseId, new Date("2026-09-11T02:30:00Z"))).rejects.toThrow(
        /OpenDrawer: stopped at "Close cashiers": 1 cashier shift still open — close them, or run Night Audit from the property/
      );
      expect((await prisma.cashierShift.findUniqueOrThrow({ where: { id: shift.id } })).closedAt).toBeNull();
      expect((await prisma.property.findUniqueOrThrow({ where: { id: p.id } })).businessDate?.toISOString().slice(0, 10)).toBe("2026-09-10");
      await setPropertySettings(p.id, { autoAuditEnabled: false });

      // The same step run from the Night Audit screen closes the drawer at the expected cash.
      const res = await asUser(adminId, () =>
        stepRoute.POST(new Request("http://localhost/api/eod/step", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: p.id, step: "cashier" }),
        }))
      );
      expect(res.status).toBe(200);
      expect((await res.json()).shiftsClosed).toBe(1);
      const closed = await prisma.cashierShift.findUniqueOrThrow({ where: { id: shift.id } });
      expect(closed.closedAt).not.toBeNull();
      expect(Number(closed.closingDrop)).toBe(200);
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
