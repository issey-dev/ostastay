import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 4 (9.4.0): slot requests on Group Blocks, approval with the
// availability check, tentative pickups, elasticity, rolling release, quota checkpoints and
// agent sales windows.

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
const { requireSession } = await import("@/lib/scope");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const slots = await import("@/lib/groups/slot-requests");
const { pickupIntoBlock } = await import("@/lib/groups/pickup");
const { processDueCheckpoints } = await import("@/lib/groups/release");
const { minTypeAvailability, outstandingBlockHolds } = await import("@/lib/availability");
const { serverToday } = await import("@/lib/business-date");

const DAY = 86_400_000;

describe("Blocks for Sources", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let sourceId: string;
  let adminId: string;
  const stamp = Date.now();
  const at = (o: number) => new Date(serverToday().getTime() + o * DAY);
  const signIn = async () => {
    cookieJar.clear();
    await createSession(adminId);
    return requireSession();
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ent = await prisma.enterprise.create({ data: { name: `Blk ${stamp}`, slug: `test-blk-${stamp}`, type: "STANDARD" } });
    enterpriseId = ent.id;
    await prisma.enterpriseLicense.create({ data: { enterpriseId, tier: "STANDARD", maxProperties: 1 } });
    propertyId = (
      await prisma.property.create({
        data: {
          enterpriseId, name: "Blk Property", code: `BLK-${stamp}`, legalName: "Blk LLC", defaultCurrency: "USD",
          timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday(),
        },
      })
    ).id;
    roomTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } })).id;
    await prisma.room.createMany({ data: [1, 2, 3, 4].map((n) => ({ propertyId, roomTypeId, roomNumber: `20${n}`, status: "AVAILABLE" })) });
    await prisma.ratePlan.create({ data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true } });
    sourceId = (await prisma.profile.create({ data: { enterpriseId, firstName: "Sun", companyName: "Sun Tours", profileType: "SOURCE" } })).upid;
    adminId = (
      await prisma.user.create({
        data: { enterpriseId, email: `blk-${stamp}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "D", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
      })
    ).id;
  });

  const request = (from: number, to: number, quantity: number, extra: Record<string, unknown> = {}) =>
    slots.createSlotRequest({
      enterpriseId, propertyId, sourceProfileId: sourceId, startDate: at(from), endDate: at(to),
      rooms: [{ roomTypeId, quantity }], ...extra,
    });

  it("a request holds nothing; approval holds the rooms as a tentative block", async () => {
    const ctx = await signIn();
    const before = await minTypeAvailability({ propertyId, roomTypeId, startDate: at(30), endDate: at(33) });
    const req = await request(30, 33, 3, { note: "Wedding party" });
    expect(req.status).toBe("REQUESTED");
    expect(await minTypeAvailability({ propertyId, roomTypeId, startDate: at(30), endDate: at(33) })).toBe(before);

    // Approve with fewer rooms than asked; what was asked is kept beside it.
    const approved = await slots.approveSlotRequest(ctx, req.id, { rooms: [{ roomTypeId, quantity: 2 }], rules: { cutoffDate: at(20) } });
    expect(approved?.status).toBe("TENTATIVE");
    expect(approved?.roomHolds[0].quantity).toBe(2);
    expect(approved?.roomHolds[0].requestedQuantity).toBe(3);
    expect(await minTypeAvailability({ propertyId, roomTypeId, startDate: at(30), endDate: at(33) })).toBe(before - 2);

    // A second Source asking for more than is left is refused at approval, with the reason.
    const other = await request(31, 32, 3);
    await expect(slots.approveSlotRequest(ctx, other.id)).rejects.toMatchObject({ code: "NO_AVAILABILITY" });
    await slots.declineSlotRequest(ctx, other.id, "Full that week");
    expect((await prisma.groupBlock.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("DECLINED");
    await expect(slots.declineSlotRequest(ctx, req.id, "x")).rejects.toMatchObject({ code: "SLOT_NOT_APPROVED" });
  });

  it("pickups: tentative with the cutoff as option, per-night hold, elasticity, Source inherited", async () => {
    const ctx = await signIn();
    const req = await request(40, 43, 1);
    await expect(pickupIntoBlock(ctx, req.id, { firstName: "A", lastName: "B", roomTypeId, checkInDate: at(40), checkOutDate: at(41) })).resolves.toMatchObject({ ok: false, code: "SLOT_NOT_APPROVED" });
    await slots.approveSlotRequest(ctx, req.id, { rules: { cutoffDate: at(30), elasticRooms: 1, elasticNightsAfter: 1 } });

    const p1 = await pickupIntoBlock(ctx, req.id, { firstName: "A", lastName: "One", roomTypeId, checkInDate: at(40), checkOutDate: at(41), status: "TENTATIVE" });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    const r1 = await prisma.reservation.findUniqueOrThrow({ where: { id: p1.reservation.id } });
    expect(r1.status).toBe("TENTATIVE");
    expect(r1.sourceProfileId).toBe(sourceId);
    expect(r1.optionDate?.toISOString().slice(0, 10)).toBe(at(30).toISOString().slice(0, 10));
    expect(r1.groupBillToMaster).toBe(false); // no master folio on a tentative block

    // A different night of the same one-room slot is still free (judged per night).
    const p2 = await pickupIntoBlock(ctx, req.id, { firstName: "A", lastName: "Two", roomTypeId, checkInDate: at(41), checkOutDate: at(43) });
    expect(p2.ok).toBe(true);
    // Night 40 again: past the hold, inside the elasticity (+1 room).
    const p3 = await pickupIntoBlock(ctx, req.id, { firstName: "A", lastName: "Three", roomTypeId, checkInDate: at(40), checkOutDate: at(41) });
    expect(p3).toMatchObject({ ok: true, elastic: true });
    // And once more: past hold + elasticity.
    const p4 = await pickupIntoBlock(ctx, req.id, { firstName: "A", lastName: "Four", roomTypeId, checkInDate: at(40), checkOutDate: at(41), origin: "AGENT_PORTAL" });
    expect(p4).toMatchObject({ ok: false, code: "SLOT_FULL" });
    // One night after the block (elastic), two after (refused).
    expect((await pickupIntoBlock(ctx, req.id, { firstName: "A", lastName: "Five", roomTypeId, checkInDate: at(42), checkOutDate: at(44) })).ok).toBe(true);
    expect(await pickupIntoBlock(ctx, req.id, { firstName: "A", lastName: "Six", roomTypeId, checkInDate: at(42), checkOutDate: at(45) })).toMatchObject({ ok: false, code: "SLOT_FULL" });
  });

  it("rolling release: nights closer than releaseDays are no longer held", async () => {
    const ctx = await signIn();
    const req = await request(3, 12, 2);
    await slots.approveSlotRequest(ctx, req.id, { rules: { releaseDays: 5 } });
    const holds = await outstandingBlockHolds({ propertyId, roomTypeId, windowStart: at(0).getTime(), windowEnd: at(15).getTime(), blockStatusIn: ["TENTATIVE"] });
    const mine = holds.find((h) => h.endMs === new Date(at(12).getFullYear(), at(12).getMonth(), at(12).getDate()).getTime());
    expect(mine).toBeDefined();
    // Held from today + 6 days on (releaseDays + 1), not from the block start.
    const sixOut = at(6);
    expect(mine!.startMs).toBe(new Date(sixOut.getFullYear(), sixOut.getMonth(), sixOut.getDate()).getTime());
  });

  it("a missed checkpoint shrinks the hold to what is booked; a met one does nothing", async () => {
    const ctx = await signIn();
    const req = await request(60, 62, 4);
    await slots.approveSlotRequest(ctx, req.id, { rules: { checkpoints: [{ date: at(-1), minPercent: 50 }, { date: at(-1), minPercent: 25 }] } });
    expect((await pickupIntoBlock(ctx, req.id, { firstName: "C", lastName: "P", roomTypeId, checkInDate: at(60), checkOutDate: at(62), status: "TENTATIVE" })).ok).toBe(true);
    const results = await processDueCheckpoints({ groupBlockId: req.id });
    // 1 of 4 booked = 25%: the 50% checkpoint is missed, the 25% one met.
    expect(results.map((r) => r.met).sort()).toEqual([false, true]);
    const block = await prisma.groupBlock.findUniqueOrThrow({ where: { id: req.id }, include: { roomHolds: true } });
    expect(block.totalRoomsHeld).toBe(1);
    expect(block.roomHolds[0].quantity).toBe(1);
    // Processed once.
    expect(await processDueCheckpoints({ groupBlockId: req.id })).toEqual([]);
  });

  it("sales windows: a request before the plan's agent sales open is refused; early access lets a source in sooner", async () => {
    const plan = await prisma.ratePlan.create({ data: { propertyId, code: `SW${stamp % 1000}`, name: "Season", isNegotiated: true, agentSalesOpenAt: at(10) } });
    const late = await prisma.profile.create({ data: { enterpriseId, firstName: "Late", companyName: "Late Travel", profileType: "SOURCE" } });
    const early = await prisma.profile.create({ data: { enterpriseId, firstName: "Early", companyName: "Early Travel", profileType: "SOURCE", earlyAccessDays: 14 } });
    await prisma.ratePlanAgentAccess.createMany({ data: [{ ratePlanId: plan.id, upid: late.upid }, { ratePlanId: plan.id, upid: early.upid }] });
    await expect(
      slots.createSlotRequest({ enterpriseId, propertyId, sourceProfileId: late.upid, startDate: at(90), endDate: at(91), rooms: [{ roomTypeId, quantity: 1 }] })
    ).rejects.toMatchObject({ code: "NOT_ON_SALE_YET" });
    await expect(
      slots.createSlotRequest({ enterpriseId, propertyId, sourceProfileId: early.upid, startDate: at(90), endDate: at(91), rooms: [{ roomTypeId, quantity: 1 }] })
    ).resolves.toMatchObject({ status: "REQUESTED" });
  });

  it("an overflow request needs no availability and sits in the OVF type", async () => {
    const ctx = await signIn();
    const req = await request(70, 71, 5, { isOverflow: true });
    const approved = await slots.approveSlotRequest(ctx, req.id);
    expect(approved?.status).toBe("TENTATIVE");
    const t = await prisma.roomType.findUniqueOrThrow({ where: { id: approved!.roomHolds[0].roomTypeId } });
    expect(t.code).toBe("OVF");
  });
});
