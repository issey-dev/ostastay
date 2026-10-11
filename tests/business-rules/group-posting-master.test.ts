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
const { ensurePostingMaster, checkInPostingMaster } = await import("@/lib/groups/posting-master");
const groupIdRoute = await import("@/app/api/groups/[id]/route");
const groupsRoute = await import("@/app/api/groups/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Group block Posting Master reservation", () => {
  let propertyId: string;
  let enterpriseId: string;
  let adminId: string;
  let accountUpid: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "PMT", slug: `test-pm-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "P", code: `PM-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyId = property.id;
    await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "Best Available Rate", priority: 1 } });
    const account = await prisma.profile.create({
      data: { enterpriseId, upid: `TA-${uniq()}`, profileType: "TRAVEL_AGENT", firstName: "Blue", lastName: "Horizon", companyName: "Blue Horizon Tours", isCreditAccount: true },
    });
    accountUpid = account.upid;
    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `pm-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
        firstName: "Admin", lastName: "PM", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  const newBlock = (extra: Record<string, unknown> = {}) =>
    prisma.groupBlock.create({
      data: {
        propertyId, code: `B-${uniq()}`, name: "Dive Group", status: "DEFINITE",
        startDate: new Date("2026-09-01"), endDate: new Date("2026-09-10"), ...extra,
      },
    });

  it("creates a PM reservation in a pseudo PM room, with the block's master folio as its folio", async () => {
    const block = await newBlock();
    const pm = await ensurePostingMaster(block.id);
    expect(pm.created).toBe(true);
    expect(pm.reservation.isPostingMaster).toBe(true);
    expect(pm.reservation.status).toBe("RESERVED");
    expect(pm.reservation.groupBlockId).toBeNull(); // not a pickup

    const assignment = await prisma.roomAssignment.findFirstOrThrow({ where: { reservationId: pm.reservation.id }, include: { roomType: true, room: true } });
    expect(assignment.roomType.isPseudo).toBe(true);
    expect(assignment.room?.roomNumber).toBe(`PM-${block.code}`);

    expect(pm.folio?.isMaster).toBe(true);
    expect(pm.folio?.groupBlockId).toBe(block.id);
    expect(pm.folio?.reservationId).toBe(pm.reservation.id);
    const linked = await prisma.groupBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(linked.postingMasterReservationId).toBe(pm.reservation.id);

    // Idempotent: asking again gives the same reservation.
    const again = await ensurePostingMaster(block.id);
    expect(again.created).toBe(false);
    expect(again.reservation.id).toBe(pm.reservation.id);
  });

  it("uses the block's credit account as the guest and bills the master folio to it", async () => {
    const block = await newBlock({ payeeProfileId: accountUpid });
    const pm = await ensurePostingMaster(block.id);
    expect(pm.reservation.primaryGuestId).toBe(accountUpid);
    expect(pm.folio?.settlementMethod).toBe("CITY_LEDGER");
    expect(pm.folio?.payeeProfileId).toBe(accountUpid);
  });

  it("attaches an older bare master folio (charges intact) instead of creating a second one", async () => {
    const block = await newBlock();
    const legacy = await prisma.folio.create({ data: { propertyId, groupBlockId: block.id, isMaster: true, walkInGuestName: "Old — Master Folio" } });
    const pm = await ensurePostingMaster(block.id);
    expect(pm.folio?.id).toBe(legacy.id);
    expect(pm.folio?.reservationId).toBe(pm.reservation.id);
    expect(await prisma.folio.count({ where: { groupBlockId: block.id, isMaster: true } })).toBe(1);
  });

  it("is created when a block goes Definite, follows the block's dates, and is cancelled with the block", async () => {
    const created = await asUser(adminId, () =>
      groupsRoute.POST(new Request("http://localhost/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, code: `T-${uniq()}`, name: "Tentative", startDate: "2026-10-01", endDate: "2026-10-05", status: "TENTATIVE" }),
      }))
    );
    const block = await created.json();
    expect((await prisma.groupBlock.findUniqueOrThrow({ where: { id: block.id } })).postingMasterReservationId).toBeNull();

    const put = (body: Record<string, unknown>) =>
      asUser(adminId, () =>
        groupIdRoute.PUT(new Request(`http://localhost/api/groups/${block.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: block.id }) })
      );

    expect((await put({ status: "DEFINITE" })).status).toBe(200);
    const after = await prisma.groupBlock.findUniqueOrThrow({ where: { id: block.id } });
    expect(after.postingMasterReservationId).toBeTruthy();

    expect((await put({ endDate: "2026-10-08" })).status).toBe(200);
    const pm = await prisma.reservation.findUniqueOrThrow({ where: { id: after.postingMasterReservationId! }, include: { assignments: true } });
    expect(pm.checkOutDate.toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(pm.assignments[0].endDate.toISOString().slice(0, 10)).toBe("2026-10-08");

    expect((await put({ status: "CANCELLED" })).status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: pm.id } })).status).toBe("CANCELLED");
  });

  it("checks the Posting Master in when a pickup checks in, once", async () => {
    const block = await newBlock();
    const pm = await ensurePostingMaster(block.id);
    const first = await checkInPostingMaster(prisma, block.id);
    expect(first?.id).toBe(pm.reservation.id);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: pm.reservation.id } });
    expect(row.status).toBe("IN_HOUSE");
    expect(row.checkedInAt).toBeTruthy();
    expect(await checkInPostingMaster(prisma, block.id)).toBeNull(); // already in house
  });

  it("refuses to cancel a block whose Posting Master already holds charges", async () => {
    const block = await newBlock();
    const pm = await ensurePostingMaster(block.id);
    const cc = await prisma.chargeCode.findFirst({ where: { propertyId } });
    if (cc && pm.folio) {
      await prisma.folioLineItem.create({ data: { folioId: pm.folio.id, description: "Charge", amount: 10, chargeCodeId: cc.id, date: new Date() } as never });
      const res = await asUser(adminId, () =>
        groupIdRoute.PUT(new Request(`http://localhost/api/groups/${block.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }) }), { params: Promise.resolve({ id: block.id }) })
      );
      expect(res.status).toBe(400);
    }
  });
});
