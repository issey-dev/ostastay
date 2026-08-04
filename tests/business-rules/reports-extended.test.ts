import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { getReport } = await import("@/lib/reports/registry");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));
const BIZ = D(2026, 7, 10); // 2026-08-10

describe("Reporting engine — Revenue / Financial / Housekeeping", () => {
  let enterpriseId: string;
  let propertyId: string;
  const ctx: any = { enterpriseId: "", userId: "u", scope: "PROPERTY" };

  const run = (key: string, params: Record<string, unknown>) =>
    getReport(key)!.run({ ctx, propertyId, params });

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({ data: { name: "XRep", slug: `test-xrep-${uniq()}`, type: "STANDARD" } });
    enterpriseId = ent.id;
    ctx.enterpriseId = ent.id;
    const roleIds = await ensureRoles(prisma, enterpriseId, SYSTEM_ROLE_DEFS, true);
    const commissionCode = await customChargeCode(enterpriseId, { code: `COMM-${uniq()}`, description: "Commission", subgroupCode: "99SY" });
    await prisma.enterpriseSettings.create({ data: { enterpriseId, greenTaxAdultAmount: 12, greenTaxChildAmount: 6, commissionChargeCodeId: commissionCode.id } });
    const property = await prisma.property.create({ data: { enterpriseId, name: "X Prop", code: `X-${uniq()}`, legalName: "X LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, roomNumber: "401", status: "DIRTY" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    const roomCode = await customChargeCode(enterpriseId, { code: `ROOM-${uniq()}`, description: "Room", subgroupCode: "10RV" });
    const gtxCode = await customChargeCode(enterpriseId, { code: "8500", description: "Green Tax", subgroupCode: "85GT" });
    const method = await prisma.paymentMethod.create({ data: { enterpriseId, name: "Cash", type: "CASH" } });
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Nat", lastName: "Ional", nationality: "GB" } });

    const res = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `X-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: BIZ, checkOutDate: D(2026, 7, 12), status: "IN_HOUSE", adults: 2, children: 0,
        assignments: { create: { roomTypeId: rt.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: BIZ, endDate: D(2026, 7, 12) } },
        folios: { create: { folioNumber: 1, propertyId } },
        specialRequests: { create: { code: "HIGH_FLOOR" } },
      },
      include: { folios: true },
    });
    const folioId = res.folios[0].id;
    await prisma.folioLineItem.createMany({
      data: [
        { folioId, chargeCodeId: roomCode.id, date: BIZ, description: "Room", amount: 100, taxAmount: 17, serviceChargeAmount: 10 },
        { folioId, chargeCodeId: gtxCode.id, date: BIZ, description: "Green Tax", amount: 24, taxAmount: 0, serviceChargeAmount: 0 },
      ],
    });

    // Green Tax registration for the primary guest.
    await prisma.guestRegistration.create({ data: { propertyId, reservationId: res.id, profileId: guest.upid, registrationNo: 1, year: 2026, isPrimary: true, businessDate: BIZ } });

    // Cashier shift + payment for the business date.
    const shift = await prisma.cashierShift.create({ data: { enterpriseId, userId: "u", propertyId, businessDate: BIZ, openingFloat: 0 } });
    await prisma.payment.create({ data: { folioId, paymentMethodId: method.id, shiftId: shift.id, amount: 151 } });

    // Housekeeping: an attendant with a completed task that took 30 minutes.
    const attUser = await prisma.user.create({ data: { enterpriseId, email: `att-${uniq()}@test.local`, passwordHash: "x", firstName: "Clara", lastName: "Clean", roles: { create: { roleId: roleIds["Housekeeping"] ?? roleIds["Admin"] } }, scope: "PROPERTY", propertyId } });
    const attendantRec = await prisma.roomAttendant.create({ data: { enterpriseId, userId: attUser.id } });
    await prisma.housekeepingTask.create({ data: { roomId: room.id, taskType: "CHECKOUT", status: "COMPLETED", assignedToId: attendantRec.id, scheduledDate: BIZ, startedAt: D(2026, 7, 10, 9, 0), completedAt: D(2026, 7, 10, 9, 30) } });
  });

  it("Folio Tax splits service charge, GST and Green Tax", async () => {
    const res = await run("fin-folio-tax", { range: { from: BIZ, to: BIZ } });
    const t = res.totals!;
    expect(t.serviceCharge).toBe(10);
    expect(t.gst).toBe(17);
    expect(t.greenTax).toBe(24);
    expect(t.totalTax).toBe(51);
  });

  it("Green Tax Report computes per-registration levy (adults × rate × nights)", async () => {
    const res = await run("fin-green-tax", { range: { from: BIZ, to: BIZ } });
    expect(res.rows).toHaveLength(1);
    expect(res.rows![0].regNo).toBe(1);
    expect(res.rows![0].greenTax).toBe(48); // 2 adults × 12 × 2 nights
  });

  it("Cashier Summary groups the day's collections", async () => {
    const res = await run("fin-cashier-summary", { date: BIZ });
    expect(res.groups!.length).toBe(1);
    expect(res.totals!.net).toBe(151);
  });

  it("Nationality Statistics tallies room nights by nationality", async () => {
    const res = await run("rev-nationality", { range: { from: BIZ, to: D(2026, 7, 11) } });
    const gb = res.rows!.find((r) => r.nationality === "GB");
    expect(gb).toBeTruthy();
    expect(gb!.roomNights).toBe(2);
  });

  it("Special Requests lists the in-house request", async () => {
    const res = await run("hk-special-requests", { date: BIZ });
    expect(res.rows!.some((r) => r.request === "HIGH_FLOOR" || r.request === "HIGH FLOOR")).toBe(true);
  });

  it("Attendant Report reports time on task", async () => {
    const res = await run("hk-attendant", { date: BIZ });
    expect(res.groups!.length).toBe(1);
    const row = res.groups![0].rows[0] as any;
    expect(row.mins).toBe(30);
  });
});
