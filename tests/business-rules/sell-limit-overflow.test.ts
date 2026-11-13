import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 2 (9.2.0): the sell limit caps desk overbooking per night, and
// overflow bookings sit in the OVF pseudo type with their own per-night cap.

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
const { createReservation } = await import("@/lib/reservations/create-reservation");
const { setSellLimits, findSellLimitBreaches } = await import("@/lib/availability-sell-limit");
const overflow = await import("@/lib/reservations/overflow");
const { serverToday } = await import("@/lib/business-date");
const { setPropertySettings } = await import("../helpers/property-settings");

const DAY = 86_400_000;

describe("Sell limit and overflow", () => {
  let propertyId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let guestUpid: string;
  let adminId: string;
  let deskId: string;
  const stamp = Date.now();
  const base = new Date(serverToday().getTime() + 60 * DAY);
  const at = (o: number) => new Date(base.getTime() + o * DAY);

  const signIn = async (userId: string) => {
    cookieJar.clear();
    await createSession(userId);
    return requireSession();
  };
  const book = (ctx: Awaited<ReturnType<typeof requireSession>>, from: number, to: number, ack = true) =>
    createReservation(ctx, {
      propertyId, primaryGuestId: guestUpid, checkInDate: at(from), checkOutDate: at(to), roomTypeId, ratePlanId, adults: 1,
      acknowledgeOverbook: ack,
    });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ent = await prisma.enterprise.create({ data: { name: `SL ${stamp}`, slug: `test-sl-${stamp}`, type: "STANDARD" } });
    await prisma.enterpriseLicense.create({ data: { enterpriseId: ent.id, tier: "STANDARD", maxProperties: 1 } });
    const property = await prisma.property.create({
      data: {
        enterpriseId: ent.id, name: "SL Property", code: `SL-${stamp}`, legalName: "SL LLC", defaultCurrency: "USD",
        timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday(),
      },
    });
    propertyId = property.id;
    roomTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } })).id;
    await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: "101", status: "AVAILABLE" } });
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true } })).id;
    guestUpid = (await prisma.profile.create({ data: { enterpriseId: ent.id, firstName: "S", lastName: "L", profileType: "GUEST" } })).upid;
    const mk = async (email: string, roleId: string) =>
      (await prisma.user.create({
        data: { enterpriseId: ent.id, email, passwordHash: await bcrypt.hash("x", 4), firstName: "S", lastName: "L", roles: { create: { roleId } }, scope: "ENTERPRISE" },
      })).id;
    adminId = await mk(`sl-admin-${stamp}@test.local`, roleIds["Admin"]);
    // Built-in Front Desk: may overbook, AVAILABILITY without delete → may not exceed the limit.
    deskId = await mk(`sl-desk-${stamp}@test.local`, roleIds["Front Desk"]);
  });

  it("no limit set: an acknowledged overbook is not capped (today's rule)", async () => {
    const desk = await signIn(deskId);
    const a = await book(desk, 0, 1);
    const b = await book(desk, 0, 1);
    expect(a.ok && b.ok).toBe(true);
  });

  it("a type limit caps the desk; a manager may exceed it", async () => {
    const admin = await signIn(adminId);
    await setSellLimits(admin, { propertyId, roomTypeId, from: at(5), to: at(5), extraRooms: 1 });
    const desk = await signIn(deskId);
    expect((await book(desk, 5, 6)).ok).toBe(true); // 1 of 1
    expect((await book(desk, 5, 6)).ok).toBe(true); // +1 over: within the limit
    const third = await book(desk, 5, 6); // +2 over: past it
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error).toMatch(/Sell limit reached/);
    const admin2 = await signIn(adminId);
    expect((await book(admin2, 5, 6)).ok).toBe(true);
  });

  it("a whole-house limit is judged on the house total", async () => {
    const admin = await signIn(adminId);
    await setSellLimits(admin, { propertyId, roomTypeId: null, from: at(8), to: at(8), extraRooms: 0 });
    const desk = await signIn(deskId);
    expect((await book(desk, 8, 9)).ok).toBe(true);
    const over = await findSellLimitBreaches({ propertyId, segments: [{ roomTypeId, startDate: at(8), endDate: at(9) }] });
    expect(over[0]).toMatch(/Whole house/);
    // Clearing the limit lifts the cap.
    await setSellLimits(admin, { propertyId, roomTypeId: null, from: at(8), to: at(8), extraRooms: null });
    expect(await findSellLimitBreaches({ propertyId, segments: [{ roomTypeId, startDate: at(8), endDate: at(9) }] })).toEqual([]);
  });

  it("only a role with the option may edit sell limits", async () => {
    const limited = await prisma.role.create({
      data: {
        enterpriseId: (await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).enterpriseId,
        name: `SL no edit ${stamp}`,
        permissions: { create: [{ module: "AVAILABILITY", canView: true, canCreate: true, canUpdate: true, canDelete: false }] },
        capabilities: { create: [{ capability: "availability.sellLimits", granted: false }] },
      },
    });
    await prisma.userRole.deleteMany({ where: { userId: deskId } });
    await prisma.userRole.create({ data: { userId: deskId, roleId: limited.id } });
    const ctx = await signIn(deskId);
    await expect(setSellLimits(ctx, { propertyId, roomTypeId, from: at(9), to: at(9), extraRooms: 2 })).rejects.toThrow(/Edit sell limits/);
  });

  it("overflow: moves to OVF, is capped per night, and can come back into a room type", async () => {
    const admin = await signIn(adminId);
    await setPropertySettings(propertyId, { maxOverflowPerNight: 1 });
    const r1 = await book(admin, 20, 22);
    const r2 = await book(admin, 20, 22);
    if (!r1.ok || !r2.ok) throw new Error("setup");
    const marked = await overflow.markOverflow(admin, r1.reservation.id, { hotelName: "Partner Beach Hotel", note: "2 nights" });
    expect(marked?.isOverflow).toBe(true);
    const a = await prisma.roomAssignment.findFirstOrThrow({ where: { reservationId: r1.reservation.id }, include: { roomType: true } });
    expect(a.roomType.code).toBe("OVF");
    expect(a.roomType.isPseudo).toBe(true);
    expect(a.roomId).toBeNull();

    // A second overflow on those nights passes the cap of 1.
    await expect(overflow.markOverflow(admin, r2.reservation.id, { hotelName: "Partner Beach Hotel" })).rejects.toMatchObject({ code: "OVERFLOW_FULL" });

    // r1 now frees the house; bring it back.
    const back = await overflow.clearOverflow(admin, r1.reservation.id, { roomTypeId, acknowledgeOverbook: true });
    expect(back?.isOverflow).toBe(false);
    const b = await prisma.roomAssignment.findFirstOrThrow({ where: { reservationId: r1.reservation.id } });
    expect(b.roomTypeId).toBe(roomTypeId);
  });

  it("overflow needs a partner hotel name", async () => {
    const admin = await signIn(adminId);
    const r = await book(admin, 30, 31);
    if (!r.ok) throw new Error("setup");
    await expect(overflow.markOverflow(admin, r.reservation.id, { hotelName: " " })).rejects.toThrow(/partner hotel/);
  });
});
