import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const { prisma } = await import("@/lib/db");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");
const { getReport } = await import("@/lib/reports/registry");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");
import { setPropertySettings } from "../helpers/property-settings";

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const D = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, m, d, h, mi));
const BIZ = D(2026, 7, 10); // 2026-08-10

describe("Reporting engine — Revenue / Financial / Housekeeping", () => {
  let enterpriseId: string;
  let propertyId: string;
  let reservationId: string;
  const ctx: any = { enterpriseId: "", userId: "u", scope: "PROPERTY" };

  const run = (key: string, params: Record<string, unknown>) =>
    getReport(key)!.run({ ctx, propertyId, params });

  beforeAll(async () => {
    const ent = await prisma.enterprise.create({ data: { name: "XRep", slug: `test-xrep-${uniq()}`, type: "STANDARD" } });
    enterpriseId = ent.id;
    ctx.enterpriseId = ent.id;
    const roleIds = await ensureRoles(prisma, enterpriseId, SYSTEM_ROLE_DEFS, true);
    const property = await prisma.property.create({ data: { enterpriseId, name: "X Prop", code: `X-${uniq()}`, legalName: "X LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: BIZ } });
    propertyId = property.id;
    const commissionCode = await customChargeCode({ propertyId }, { code: `COMM-${uniq()}`, description: "Commission", subgroupCode: "99SY" });
    await setPropertySettings(property.id, { greenTaxAdultAmount: 12, greenTaxChildAmount: 6, commissionChargeCodeId: commissionCode.id });
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: rt.id, roomNumber: "401", status: "DIRTY" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    const roomCode = await customChargeCode({ propertyId }, { code: `ROOM-${uniq()}`, description: "Room", subgroupCode: "10RV" });
    const gtxCode = await customChargeCode({ propertyId }, { code: "8500", description: "Green Tax", subgroupCode: "85GT" });
    const method = await prisma.paymentMethod.create({ data: { enterpriseId, propertyId, name: "Cash", type: "CASH" } });
    const guest = await prisma.profile.create({
      data: {
        enterpriseId, profileType: "GUEST", firstName: "Nat", lastName: "Ional", nationality: "GB", dateOfBirth: D(1990, 3, 4),
        documents: { create: { documentType: "PASSPORT", documentNumber: "P1234567", isPrimary: true } },
      },
    });

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
    reservationId = res.id;
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

  it("Green Tax Report lists each registration in the MIRA sheet layout", async () => {
    const res = await run("fin-green-tax", { range: { from: BIZ, to: BIZ } });
    expect(res.columns.map((c) => c.label)).toEqual([
      "Guest Registration No.", "Name of Guest", "Category", "Date of birth", "Identification No.", "Nationality",
      "Booking Method", "Check-in Date", "Check-in Time", "Check-out Date", "Check-out Time",
    ]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows![0]).toMatchObject({
      regNo: 1, guest: "IONAL NAT", category: 1, idNo: "P1234567", nationality: "UNITED KINGDOM",
      bookingMethod: "FIT", // no travel agent on the booking
      checkInTime: "14:00", checkOutTime: "11:00", // not yet checked in → property standard times
    });
    expect((res.rows![0].checkOutDate as Date).toISOString()).toBe(D(2026, 7, 12).toISOString());
  });

  it("Green Tax categories: infant 4, Maldivian 2, work permit 3, the agent's booking method", async () => {
    const mk = (firstName: string, extra: Record<string, unknown>) =>
      prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName, lastName: "Cat", ...extra } });
    const infant = await mk("Baby", { dateOfBirth: D(2025, 0, 1), nationality: "MV" });
    const local = await mk("Local", { nationality: "MV" });
    const permit = await mk("Worker", { nationality: "IN", documents: { create: { documentType: "PASSPORT", documentNumber: "W1", isWorkPermit: true } } });
    for (const [i, p] of [infant, local, permit].entries()) {
      await prisma.guestRegistration.create({ data: { propertyId, reservationId, profileId: p.upid, registrationNo: 10 + i, year: 2026, businessDate: BIZ } });
    }
    const res = await run("fin-green-tax", { range: { from: BIZ, to: BIZ } });
    expect(res.rows!.filter((r) => (r.regNo as number) >= 10).map((r) => r.category)).toEqual([4, 2, 3]);

    const { bookingMethodFor } = await import("@/lib/green-tax-sheet");
    expect(bookingMethodFor(null)).toBe("FIT");
    expect(bookingMethodFor({ bookingMethod: "Online travel agent" })).toBe("Online travel agent");
    expect(bookingMethodFor({ bookingMethod: null })).toBeNull(); // agent without a method is flagged, not guessed
  });

  it("Missing Profile Information flags skipped Reg Nos, missing profile data and an unset booking method", async () => {
    // By now the year holds Reg Nos 1 and 10–12 (the category test) → 2..9 are skipped.
    const res = await run("fin-green-tax-missing", { range: { from: BIZ, to: BIZ } });
    const byLabel = (prefix: string) => res.groups!.find((g) => g.label.startsWith(prefix))?.rows ?? [];
    expect(byLabel("High").map((r) => r.regNo)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(byLabel("Medium")).toHaveLength(0); // the booked guest has ID, DOB and nationality
    expect(byLabel("Low")).toHaveLength(0); // no travel agent → FIT, nothing to set

    // Attach a travel agent with no Booking Method, and add an accompanying guest with no
    // ID/DOB/nationality who was never numbered.
    const ta = await prisma.profile.create({ data: { enterpriseId, profileType: "TRAVEL_AGENT", firstName: "", companyName: "Blue Atoll Tours" } });
    const acc = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Plus", lastName: "One" } });
    await prisma.reservation.update({ where: { id: reservationId }, data: { travelAgentId: ta.upid, accompanyingGuests: { create: { profileId: acc.upid } } } });
    const after = await run("fin-green-tax-missing", { range: { from: BIZ, to: BIZ } });
    const g = (prefix: string) => after.groups!.find((x) => x.label.startsWith(prefix))?.rows ?? [];
    expect(g("High").find((r) => r.guest === "ONE PLUS")?.issue).toBe("No Reg No assigned");
    expect(g("Medium").find((r) => r.guest === "ONE PLUS")?.issue).toBe("Missing Identification No., Date of birth, Nationality");
    expect(g("Low").map((r) => r.travelAgent)).toEqual(["Blue Atoll Tours", "Blue Atoll Tours"]);
    await prisma.reservation.update({ where: { id: reservationId }, data: { travelAgentId: null, accompanyingGuests: { deleteMany: {} } } });
  });

  it("Green Tax Report selects by stay date, not registration date", async () => {
    // The stay is 10 Aug → 12 Aug (nights of the 10th and 11th).
    const regNos = async (from: Date, to: Date) =>
      (await run("fin-green-tax", { range: { from, to } })).rows!.map((r) => r.regNo);
    expect(await regNos(D(2026, 7, 11), D(2026, 7, 11))).toContain(1); // stay-over night, registered the day before
    expect(await regNos(D(2026, 7, 12), D(2026, 7, 31))).not.toContain(1); // departure day onward — no night stayed
    expect(await regNos(D(2026, 6, 1), D(2026, 6, 31))).not.toContain(1); // the month before arrival
  });

  it("Green Tax Excel export is the bare MIRA sheet", async () => {
    const def = getReport("fin-green-tax")!;
    const result = await def.run({ ctx, propertyId, params: { range: { from: BIZ, to: BIZ } } });
    const buf = await def.renderXlsx!(result);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.getWorksheet("GRTInfoSheet25.1")!;
    expect(ws.getCell("A1").value).toBe("Guest Registration No.");
    expect(ws.getCell("K1").value).toBe("Check-out Time");
    expect(ws.getCell("A2").value).toBe(1);
    expect(ws.getCell("G2").value).toBe("FIT");
    expect((ws.getCell("H2").value as Date).toISOString()).toBe(BIZ.toISOString());
    expect(ws.getCell("H2").numFmt).toBe(" dd/mm/yyyy"); // the template's own format
    // A time-of-day cell reads back as that time on Excel's day zero (1899-12-30).
    expect((ws.getCell("I2").value as Date).toISOString()).toBe("1899-12-30T14:00:00.000Z");
    expect(ws.rowCount).toBe(1 + result.rows!.length);
  });

  it("Cashier Summary groups the day's collections", async () => {
    const res = await run("fin-cashier-summary", { date: BIZ });
    expect(res.groups!.length).toBe(1);
    expect(res.totals!.net).toBe(151);
  });

  it("Nationality Statistics tallies room nights by nationality (master-list label)", async () => {
    const res = await run("rev-nationality", { range: { from: BIZ, to: D(2026, 7, 11) } });
    const gb = res.rows!.find((r) => r.nationality === "British");
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
