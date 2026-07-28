import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { generateEodReports, snapshotEodReports, EOD_REPORT_TYPES } = await import("@/lib/eod-reports");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const BIZ = new Date(Date.UTC(2026, 3, 20)); // 2026-04-20
const dayEnd = new Date(BIZ.getTime() + 86_400_000);

describe("EOD report snapshots", () => {
  let enterpriseId: string;
  let propertyId: string;
  let rtId: string;
  let pseudoRtId: string;
  let ratePlanId: string;
  let roomChargeCodeId: string;
  let fbChargeCodeId: string;
  let cashMethodId: string;
  let cashierUserId: string;
  let shiftId: string;
  let guestId: string;
  let taId: string;

  beforeAll(async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: "EodRep", slug: `test-erep-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const roleIds = await ensureRoles(prisma, enterpriseId, SYSTEM_ROLE_DEFS, true);
    const property = await prisma.property.create({ data: { enterpriseId, name: "ER Prop", code: `ER-${uniq()}`, legalName: "ER LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    rtId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2, isPseudo: false } })).id;
    pseudoRtId = (await prisma.roomType.create({ data: { propertyId, name: "Day", code: "DAY", maxOccupancy: 2, isPseudo: true } })).id;
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } })).id;
    roomChargeCodeId = (await customChargeCode(enterpriseId, { code: `ROOM-${uniq()}`, description: "Room Revenue", subgroupCode: "ROOM_REVENUE" })).id;
    fbChargeCodeId = (await customChargeCode(enterpriseId, { code: `FB-${uniq()}`, description: "Restaurant", subgroupCode: "RESTAURANT" })).id;
    cashMethodId = (await prisma.paymentMethod.create({ data: { enterpriseId, name: "Cash", type: "CASH" } })).id;
    const cashier = await prisma.user.create({ data: { enterpriseId, email: `er-cash-${uniq()}@test.local`, passwordHash: "x", firstName: "Cash", lastName: "Ier", roleId: roleIds["Cashier"], scope: "PROPERTY", propertyId } });
    cashierUserId = cashier.id;
    shiftId = (await prisma.cashierShift.create({ data: { enterpriseId, userId: cashier.id, propertyId, businessDate: BIZ, openingFloat: 100 } })).id;
    guestId = (await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Gina", lastName: "Guest" } })).upid;
    taId = (await prisma.profile.create({ data: { enterpriseId, profileType: "TRAVEL_AGENT", firstName: "ACME Travel", companyName: "ACME Travel" } })).upid;

    // Two sellable rooms + one day-use (pseudo) room.
    const roomA = await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: "101", status: "OCCUPIED" } });
    await prisma.room.create({ data: { propertyId, roomTypeId: rtId, roomNumber: "102", status: "CLEAN" } });
    await prisma.room.create({ data: { propertyId, roomTypeId: pseudoRtId, roomNumber: "D1", status: "CLEAN" } });

    // In-house guest folio: room charge + F&B charge dated the business date, one cash payment.
    const inhouse = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `ER-${uniq()}`, primaryGuestId: guestId,
        checkInDate: BIZ, checkOutDate: new Date(BIZ.getTime() + 2 * 86_400_000), status: "IN_HOUSE", adults: 1, checkedInAt: BIZ,
        assignments: { create: { roomTypeId: rtId, roomId: roomA.id, ratePlanId, overrideRate: 200, startDate: BIZ, endDate: new Date(BIZ.getTime() + 2 * 86_400_000) } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    const inhouseFolio = inhouse.folios[0].id;
    await prisma.folioLineItem.createMany({
      data: [
        { folioId: inhouseFolio, chargeCodeId: roomChargeCodeId, date: BIZ, description: "Room", amount: 200, taxAmount: 20, serviceChargeAmount: 10 },
        { folioId: inhouseFolio, chargeCodeId: fbChargeCodeId, date: BIZ, description: "Dinner", amount: 50, taxAmount: 5, serviceChargeAmount: 0 },
      ],
    });
    await prisma.payment.create({ data: { folioId: inhouseFolio, paymentMethodId: cashMethodId, shiftId, amount: 100, createdAt: new Date(BIZ.getTime() + 3_600_000) } });

    // RESERVED reservation with a pre-arrival deposit.
    const reserved = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `ER-${uniq()}`, primaryGuestId: guestId,
        checkInDate: new Date(BIZ.getTime() + 5 * 86_400_000), checkOutDate: new Date(BIZ.getTime() + 7 * 86_400_000), status: "RESERVED", adults: 1,
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    await prisma.payment.create({ data: { folioId: reserved.folios[0].id, paymentMethodId: cashMethodId, shiftId, amount: 150, depositPurpose: "DEPOSIT", createdAt: new Date(BIZ.getTime() + 7_200_000) } });

    // Finalized debtor invoice (checked-out CITY_LEDGER folio) with an outstanding balance.
    const debtor = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `ER-${uniq()}`, primaryGuestId: guestId, travelAgentId: taId,
        checkInDate: new Date(BIZ.getTime() - 2 * 86_400_000), checkOutDate: BIZ, status: "CHECKED_OUT", adults: 1,
        folios: { create: { folioNumber: 1, propertyId, settlementMethod: "CITY_LEDGER", isDebtorAccount: true, payeeProfileId: taId } },
      },
      include: { folios: true },
    });
    await prisma.folioLineItem.create({ data: { folioId: debtor.folios[0].id, chargeCodeId: roomChargeCodeId, date: new Date(BIZ.getTime() - 86_400_000), description: "Room", amount: 300, taxAmount: 30, serviceChargeAmount: 0 } });
  });

  it("Manager Flash reports occupancy, ADR and revenue for the night", async () => {
    const r = await generateEodReports(propertyId, BIZ);
    const mf = r.MANAGER_FLASH as any;
    expect(mf.occupancy.roomsAvailable).toBe(2); // pseudo/day-use excluded
    expect(mf.occupancy.roomsOccupied).toBe(1);
    expect(mf.occupancy.occupancyPct).toBe(50);
    // Room revenue for the day = 200 + 20 + 10 = 230; ADR = 230 / 1 occupied.
    expect(mf.occupancy.adr).toBe(230);
    expect(mf.occupancy.revPar).toBe(115); // 230 / 2 available
    expect(mf.revenue.roomRevenue).toBe(230);
    expect(mf.revenue.otherRevenue).toBe(55); // F&B 50 + 5 tax
    expect(mf.activity.arrivals).toBe(1);
  });

  it("Trial Balance shows the day's charge debits and payment credits by category/method", async () => {
    const r = await generateEodReports(propertyId, BIZ);
    const tb = r.TRIAL_BALANCE as any;
    // Debits = room 230 + F&B 55 = 285 (the debtor's charge is dated the prior day, excluded).
    expect(tb.charges.total).toBe(285);
    const room = tb.charges.byCategory.find((c: any) => c.category === "ROOM");
    expect(room.total).toBe(230);
    // Credits = the two cash payments made on the business date (100 + 150).
    expect(tb.payments.total).toBe(250);
    expect(tb.payments.byMethod[0].method).toBe("Cash");
  });

  it("Guest / AR / Deposit ledgers report the right positions", async () => {
    const r = await generateEodReports(propertyId, BIZ);
    const gl = r.GUEST_LEDGER as any;
    // In-house folio: charges 285, payment 100 → balance 185.
    expect(gl.rows).toHaveLength(1);
    expect(gl.totals.balance).toBe(185);

    const ar = r.AR_LEDGER as any;
    expect(ar.rows).toHaveLength(1);
    expect(ar.rows[0].account).toBe("ACME Travel");
    expect(ar.totals.balance).toBe(330); // 300 + 30 tax

    const dep = r.DEPOSIT_LEDGER as any;
    expect(dep.rows).toHaveLength(1);
    expect(dep.totals.deposit).toBe(150);
    expect(dep.totals.creditHeld).toBe(150); // no charges on the reserved folio yet
  });

  it("Cashier Summary groups the day's collections by cashier", async () => {
    const r = await generateEodReports(propertyId, BIZ);
    const cs = r.CASHIER_SUMMARY as any;
    expect(cs.rows).toHaveLength(1);
    expect(cs.rows[0].user).toBe("Cash Ier");
    expect(cs.rows[0].net).toBe(250);
    expect(cs.totals.net).toBe(250);
  });

  it("snapshotEodReports freezes all six report types for the date", async () => {
    await snapshotEodReports(propertyId, BIZ);
    const rows = await prisma.eodReport.findMany({ where: { propertyId, businessDate: BIZ } });
    expect(rows.map((x) => x.reportType).sort()).toEqual([...EOD_REPORT_TYPES].sort());
    // Re-running overwrites rather than duplicating.
    await snapshotEodReports(propertyId, BIZ);
    expect(await prisma.eodReport.count({ where: { propertyId, businessDate: BIZ } })).toBe(6);
  });
});
