import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 8 (9.8.0): the group's documents in one PDF, the whole group's
// Advance Folio (in-house pickups only, routed to the master), and the desk rooming-list import.

const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  }),
}));

const { prisma } = await import("@/lib/db");
const { createSession } = await import("@/lib/auth");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const { customChargeCode } = await import("../helpers/charge-codes");
const { setPropertySettings } = await import("../helpers/property-settings");
const { buildGroupStatementPdf } = await import("@/lib/groups/group-statement-pdf");
const advanceRoute = await import("@/app/api/groups/[id]/advance-folio/route");
const roomingRoute = await import("@/app/api/groups/[id]/rooming-list/route");

const DAY = 86_400_000;

describe("Group billing", () => {
  const stamp = Date.now();
  let propertyId: string, blockId: string, masterFolioId: string, roomTypeId: string, adminId: string;
  const biz = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ent = await prisma.enterprise.create({ data: { name: `GB ${stamp}`, slug: `test-gb-${stamp}`, type: "STANDARD" } });
    propertyId = (
      await prisma.property.create({
        data: { enterpriseId: ent.id, name: "GB", code: `GB-${stamp}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: biz },
      })
    ).id;
    roomTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } })).id;
    await prisma.room.createMany({ data: [1, 2, 3, 4].map((n) => ({ propertyId, roomTypeId, roomNumber: `5${n}${stamp % 10}` })) });
    await customChargeCode({ propertyId }, { code: "1000", description: "Room" });
    const accom = await customChargeCode({ propertyId }, { code: "ACCOM", description: "Accommodation", subgroupCode: "10RV" });
    const plan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR", chargeCodeId: accom.id, priority: 1 } });
    await setPropertySettings(propertyId, { greenTaxEnabled: false, defaultAccommodationChargeCodeId: accom.id });
    blockId = (
      await prisma.groupBlock.create({
        data: { propertyId, code: `GB${stamp % 10000}`, name: "Wedding", startDate: biz, endDate: new Date(biz.getTime() + 3 * DAY), status: "DEFINITE", totalRoomsHeld: 4, roomHolds: { create: { roomTypeId, quantity: 4 } } },
      })
    ).id;
    masterFolioId = (await prisma.folio.create({ data: { propertyId, groupBlockId: blockId, isMaster: true, folioNumber: 1 } })).id;
    const guest = await prisma.profile.create({ data: { enterpriseId: ent.id, firstName: "G", lastName: "One", profileType: "GUEST" } });
    const guest2 = await prisma.profile.create({ data: { enterpriseId: ent.id, firstName: "G", lastName: "Two", profileType: "GUEST" } });
    for (const [g, status] of [[guest.upid, "IN_HOUSE"], [guest2.upid, "RESERVED"]] as const) {
      await prisma.reservation.create({
        data: {
          propertyId, confirmationNo: `GB${stamp}${g.slice(0, 4)}`, primaryGuestId: g, groupBlockId: blockId, groupBillToMaster: true,
          checkInDate: biz, checkOutDate: new Date(biz.getTime() + 3 * DAY), status, adults: 1,
          assignments: { create: { roomTypeId, ratePlanId: plan.id, overrideRate: 100, startDate: biz, endDate: new Date(biz.getTime() + 3 * DAY) } },
          folios: { create: { folioNumber: 1, propertyId } },
        },
      });
    }
    adminId = (
      await prisma.user.create({
        data: { enterpriseId: ent.id, email: `gb-${stamp}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "D", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
      })
    ).id;
    cookieJar.clear();
    await createSession(adminId);
  });

  it("Advance Folio for the group posts in-house pickups to the master folio and skips the rest", async () => {
    const res = await advanceRoute.POST(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ id: blockId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.posted).toBe(1);
    expect(data.results.find((r: { ok: boolean }) => !r.ok).error).toBe("Not in house");
    const master = await prisma.folioLineItem.findMany({ where: { folioId: masterFolioId, isVoid: false } });
    const total = master.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0);
    expect(total).toBeCloseTo(300, 1);
  });

  it("the group statement is one PDF with every folio and the total", async () => {
    const { pdf, total, filename } = await buildGroupStatementPdf(blockId);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
    expect(total).toBeCloseTo(300, 1);
    expect(filename).toMatch(/statement\.pdf$/);
  });

  it("a rooming list adds good lines and reports bad ones", async () => {
    const day = (o: number) => new Date(biz.getTime() + o * DAY).toISOString().slice(0, 10);
    const csv = [
      "firstName,lastName,checkIn,checkOut,roomTypeCode,adults,children,email,tentative",
      `Ann,Lee,${day(0)},${day(2)},STD,2,0,,yes`,
      `Bob,Ray,${day(0)},${day(2)},XXX,1,0,,`,
    ].join("\n");
    const res = await roomingRoute.POST(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ csv }) }), { params: Promise.resolve({ id: blockId }) });
    const data = await res.json();
    expect(data.added).toBe(1);
    expect(data.results[1]).toMatchObject({ ok: false });
    const ann = await prisma.reservation.findFirstOrThrow({ where: { groupBlockId: blockId, primaryGuest: { firstName: "Ann" } } });
    expect(ann.status).toBe("TENTATIVE");
  });
});
