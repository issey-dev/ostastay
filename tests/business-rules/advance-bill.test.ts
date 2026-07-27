import { describe, it, expect, vi } from "vitest";
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

const advanceBillRoute = await import("@/app/api/reservations/[id]/advance-bill/route");
const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");
const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");

const DAY = 86400000;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

// A 3-night in-house stay priced by a flat overrideRate (100/night), so no PriceCalendar
// is needed. Business date = arrival day, so all 3 nights are still un-billed.
async function setup() {
  const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({ data: { name: "AdvBill", slug: `test-advbill-${uniq()}`, type: "STANDARD" } });
  const biz = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const property = await prisma.property.create({
    data: { enterpriseId: enterprise.id, name: "P", code: `ADV-${uniq()}`, legalName: "P LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: biz },
  });
  const roomType = await prisma.roomType.create({ data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 } });
  const room = await prisma.room.create({ data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `${Math.floor(Math.random() * 900 + 100)}` } });
  await prisma.chargeCode.create({ data: { enterpriseId: enterprise.id, code: "ROOM", description: "Room" } });
  const accom = await prisma.chargeCode.create({ data: { enterpriseId: enterprise.id, code: "ACCOM", description: "Accommodation", category: "ROOM" } });
  const ratePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "BAR", name: "Best Available", chargeCodeId: accom.id } });
  await prisma.enterpriseSettings.create({ data: { enterpriseId: enterprise.id, greenTaxEnabled: false, defaultAccommodationChargeCodeId: accom.id } });
  const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "G", lastName: "T" } });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id, confirmationNo: `ADV-${uniq()}`, primaryGuestId: guest.upid,
      checkInDate: biz, checkOutDate: new Date(biz.getTime() + 3 * DAY), status: "IN_HOUSE", adults: 1, children: 0,
      assignments: { create: { roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100, startDate: biz, endDate: new Date(biz.getTime() + 3 * DAY) } },
      folios: { create: { folioNumber: 1, propertyId: property.id } },
    },
    include: { folios: true },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({ data: { enterpriseId: enterprise.id, email: `adv-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "Adv", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
  return { propertyId: property.id, reservationId: reservation.id, folioId: reservation.folios[0].id, adminId: admin.id, biz };
}

const advanceBill = (adminId: string, reservationId: string, body: object) =>
  asUser(adminId, () => advanceBillRoute.POST(
    new Request(`http://localhost/api/reservations/${reservationId}/advance-bill`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: reservationId }) }
  ));

describe("Advance Bill", () => {
  it("posts the chosen number of nights upfront and marks advanceBilledThrough", async () => {
    const { reservationId, folioId, adminId, biz } = await setup();
    const resp = await advanceBill(adminId, reservationId, { nights: 2 });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.nights).toBe(2);

    // Two nights of room at 100/night (tax-inclusive) = 200 total posted as advance lines
    // dated today. The rate splits into base + GST + service charge; the total is what matters.
    const roomLines = await prisma.folioLineItem.findMany({ where: { folioId, description: { contains: "Accommodation" } } });
    const roomTotal = roomLines.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0);
    expect(roomTotal).toBeCloseTo(200, 1);
    expect(data.amountPosted).toBeCloseTo(200, 1);

    // Billed through the 2nd night (biz + 1).
    const res = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(res!.advanceBilledThrough!.getTime()).toBe(biz.getTime() + DAY);
  });

  it("Night Audit does NOT re-post an advance-billed night (no double charge)", async () => {
    const { propertyId, reservationId, folioId, adminId } = await setup();
    // Advance-bill tonight + tomorrow.
    expect((await advanceBill(adminId, reservationId, { nights: 2 })).status).toBe(200);
    const advanceLinesBefore = await prisma.folioLineItem.count({ where: { folioId } });

    // Run tonight's audit — this night is already advance-billed, so it must be skipped.
    const auditResp = await asUser(adminId, () => nightAuditRunRoute.POST(
      new Request("http://localhost/api/night-audit/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId }) })
    ));
    expect(auditResp.status).toBe(200);

    // No "Nightly Room Charge" was posted, and no new lines appeared on the folio.
    const nightly = await prisma.folioLineItem.count({ where: { folioId, description: "Nightly Room Charge" } });
    expect(nightly).toBe(0);
    expect(await prisma.folioLineItem.count({ where: { folioId } })).toBe(advanceLinesBefore);
  });

  it("caps a request at the remaining nights", async () => {
    const { reservationId, adminId } = await setup();
    const resp = await advanceBill(adminId, reservationId, { nights: 99 });
    expect(resp.status).toBe(200);
    expect((await resp.json()).nights).toBe(3); // only 3 nights in the stay
  });

  // A2 regression: two concurrent advance-bills for the same reservation must bill the
  // nights ONCE. The atomic check-and-set on advanceBilledThrough lets exactly one win.
  it("two concurrent advance-bills post the nights once (no double bill)", async () => {
    const { reservationId, folioId, adminId, biz } = await setup();

    const [a, b] = await Promise.all([
      advanceBill(adminId, reservationId, { nights: 3 }),
      advanceBill(adminId, reservationId, { nights: 3 }),
    ]);
    // Exactly one run posts; the other is rejected (409 from the guard, or a rolled-back
    // DB-lock error under SQLite). What matters is that it does NOT bill a second time.
    const okCount = [a, b].filter((r) => r.status === 200).length;
    expect(okCount).toBe(1);

    // Three nights of accommodation at 100/night posted exactly once = 300 total.
    const roomLines = await prisma.folioLineItem.findMany({ where: { folioId, description: { contains: "Accommodation" } } });
    const roomTotal = roomLines.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0);
    expect(roomTotal).toBeCloseTo(300, 1);

    // Billed through the last night (biz + 2), set once.
    const res = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(res!.advanceBilledThrough!.getTime()).toBe(biz.getTime() + 2 * DAY);
  });
});

// The purpose of declaring generates is that posting the main charge code auto-posts its
// taxes — on EVERY path, not just at Night Audit. An advance bill posts the exact figures
// the reservation quote showed the guest, so its generates ROUTE those figures onto the
// group's tax codes rather than recalculating: the advance bill and the nights it replaces
// come out to the same total, split across the same codes.
describe("Advance Bill: generates post all defined taxes", () => {
  async function setupWithChart(greenTax: boolean) {
    const base = await setup();
    const property = await prisma.property.findUniqueOrThrow({ where: { id: base.propertyId } });
    await ensureChargeTree(prisma, property.enterpriseId);
    await prisma.enterpriseSettings.update({
      where: { enterpriseId: property.enterpriseId },
      data: { greenTaxEnabled: greenTax, greenTaxAdultAmount: 12, greenTaxChildAmount: 6 },
    });
    // Bill against the charted accommodation code so the group's tax codes apply.
    const room = await prisma.chargeCode.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId: property.enterpriseId, code: "ROOM" } },
    });
    await prisma.ratePlan.updateMany({ where: { propertyId: base.propertyId }, data: { chargeCodeId: room.id } });
    return base;
  }

  it("routes Service Charge and GST onto the accommodation group's own tax codes", async () => {
    const { reservationId, folioId, adminId } = await setupWithChart(false);
    const resp = await advanceBill(adminId, reservationId, { nights: 2 });
    expect(resp.status).toBe(200);

    const lines = await prisma.folioLineItem.findMany({ where: { folioId }, include: { chargeCode: true } });
    const svc = lines.find((l) => l.chargeCode.code === "SVCACM");
    const gst = lines.find((l) => l.chargeCode.code === "GSTACM");
    expect(svc, "advance bill must post the group's service charge code").toBeDefined();
    expect(gst, "advance bill must post the group's GST code").toBeDefined();

    // 2 nights at a tax-inclusive 100 = 200 gross, backed out to 155.40 / 15.54 / 29.06.
    const room = lines.find((l) => l.chargeCode.code === "ROOM")!;
    expect(room.amount).toBeCloseTo(155.4, 1);
    expect(room.taxAmount).toBe(0);
    expect(room.serviceChargeAmount).toBe(0);
    expect(svc!.serviceChargeAmount).toBeCloseTo(15.54, 1);
    expect(gst!.taxAmount).toBeCloseTo(29.06, 1);

    // Total unchanged by the split — still exactly the two nights that were quoted.
    const total = lines.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0);
    expect(total).toBeCloseTo(200, 1);
    expect((await resp.json()).amountPosted).toBeCloseTo(200, 1);
  });

  it("levies Green Tax across every billed night, exactly once", async () => {
    const { reservationId, folioId, adminId } = await setupWithChart(true);
    const resp = await advanceBill(adminId, reservationId, { nights: 3 });
    expect(resp.status).toBe(200);

    const gtx = await prisma.folioLineItem.findMany({
      where: { folioId, chargeCode: { code: "GTX" } },
    });
    expect(gtx).toHaveLength(1);
    // 1 adult x $12 x 3 nights.
    expect(gtx[0].amount).toBe(36);
    expect(gtx[0].taxAmount).toBe(0);
  });
});
