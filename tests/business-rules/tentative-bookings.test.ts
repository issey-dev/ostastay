import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 1 (9.1.0): the TENTATIVE status, its option date, confirmation,
// expiry (job and lazy), the confirm-versus-expire race and the last-room race.

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
const options = await import("@/lib/reservations/options");
const statusRoute = await import("@/app/api/reservations/[id]/status/route");
const { serverToday } = await import("@/lib/business-date");

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const DAY = 86_400_000;

describe("computeOptionDate (pure)", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  it("uses the block cutoff while it is ahead", () => {
    const d = options.computeOptionDate({ checkInDate: utc(2027, 3, 1), now, blockCutoff: utc(2027, 1, 15) });
    expect(d.toISOString()).toBe("2027-01-15T23:59:59.000Z");
  });
  it("else arrival minus the option days", () => {
    const d = options.computeOptionDate({ checkInDate: utc(2027, 3, 1), now, optionDaysBeforeArrival: 30 });
    expect(d.toISOString().slice(0, 10)).toBe("2027-01-30");
  });
  it("a late booking gets the short option, never past arrival", () => {
    const d = options.computeOptionDate({ checkInDate: utc(2026, 11, 20), now, optionDaysBeforeArrival: 30, shortOptionHours: 48 });
    expect(d.getTime()).toBe(now.getTime() + 48 * 3600_000);
    const e = options.computeOptionDate({ checkInDate: utc(2026, 11, 13), now, shortOptionHours: 72 });
    expect(e.getTime()).toBeLessThanOrEqual(utc(2026, 11, 13).getTime());
  });
});

describe("Tentative bookings", () => {
  let propertyId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let guestUpid: string;
  let adminId: string;
  let limitedId: string;
  const stamp = Date.now();
  // Far enough ahead that the default option (arrival − 30 days) is in the future.
  const base = new Date(serverToday().getTime() + 120 * DAY);
  const at = (offset: number) => new Date(base.getTime() + offset * DAY);

  const signIn = async (userId: string) => {
    cookieJar.clear();
    await createSession(userId);
    return requireSession();
  };

  const book = async (ctx: Awaited<ReturnType<typeof requireSession>>, from: number, to: number, extra: Record<string, unknown> = {}) =>
    createReservation(ctx, {
      propertyId,
      primaryGuestId: guestUpid,
      checkInDate: at(from),
      checkOutDate: at(to),
      roomTypeId,
      ratePlanId,
      adults: 1,
      ...extra,
    });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ent = await prisma.enterprise.create({ data: { name: `Tent ${stamp}`, slug: `test-tent-${stamp}`, type: "STANDARD" } });
    await prisma.enterpriseLicense.create({ data: { enterpriseId: ent.id, tier: "STANDARD", maxProperties: 1 } });
    const property = await prisma.property.create({
      data: {
        enterpriseId: ent.id, name: "Tent Property", code: `TNT-${stamp}`, legalName: "Tent LLC", defaultCurrency: "USD",
        timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday(),
      },
    });
    propertyId = property.id;
    const rt = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    roomTypeId = rt.id;
    // ONE room: every test below fights over it.
    await prisma.room.create({ data: { propertyId, roomTypeId, roomNumber: "101", status: "AVAILABLE" } });
    ratePlanId = (await prisma.ratePlan.create({ data: { propertyId, code: "BASE", name: "Base", priority: 999, isLocked: true } })).id;
    guestUpid = (await prisma.profile.create({ data: { enterpriseId: ent.id, firstName: "Tent", lastName: "Guest", profileType: "GUEST" } })).upid;
    const mk = async (email: string, roleId: string) =>
      (await prisma.user.create({
        data: {
          enterpriseId: ent.id, email, passwordHash: await bcrypt.hash("password123", 4), firstName: "T", lastName: "U",
          roles: { create: { roleId } }, scope: "ENTERPRISE",
        },
      })).id;
    adminId = await mk(`tent-admin-${stamp}@test.local`, roleIds["Admin"]);
    // A custom role with full Reservations but the option capability switched off.
    const limited = await prisma.role.create({
      data: {
        enterpriseId: ent.id, name: `No options ${stamp}`,
        permissions: { create: [{ module: "RESERVATIONS", canView: true, canCreate: true, canUpdate: true, canDelete: true }] },
        capabilities: { create: [{ capability: "reservations.manageOption", granted: false }] },
      },
    });
    limitedId = await mk(`tent-limited-${stamp}@test.local`, limited.id);
  });

  it("a tentative booking holds the room and gets the default option date", async () => {
    const ctx = await signIn(adminId);
    const r = await book(ctx, 0, 3, { status: "TENTATIVE" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: r.reservation.id } });
    expect(row.status).toBe("TENTATIVE");
    expect(row.origin).toBe("DESK");
    expect(row.optionDate?.toISOString().slice(0, 10)).toBe(new Date(at(0).getTime() - 30 * DAY).toISOString().slice(0, 10));

    // The only room is held: a second booking on those nights needs an overbook confirmation.
    const second = await book(ctx, 1, 2);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.requiresOverbookConfirm).toBe(true);

    // Confirm → RESERVED, stamped.
    const confirmed = await options.confirmTentative(ctx, r.reservation.id, "Deposit received");
    expect(confirmed?.status).toBe("RESERVED");
    expect(confirmed?.confirmedBy).toBe(adminId);
    expect(confirmed?.confirmationNote).toBe("Deposit received");

    // RESERVED never goes back to TENTATIVE.
    const back = await statusRoute.PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "TENTATIVE" }) }),
      { params: Promise.resolve({ id: r.reservation.id }) }
    );
    expect(back.status).toBe(400);
    await prisma.reservation.update({ where: { id: r.reservation.id }, data: { status: "CANCELLED" } });
  });

  it("an expired option is released (kept as a record) and frees the room", async () => {
    const ctx = await signIn(adminId);
    const r = await book(ctx, 10, 12, { status: "TENTATIVE" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await prisma.reservation.update({ where: { id: r.reservation.id }, data: { optionDate: new Date(Date.now() - 1000) } });

    // Confirming an expired option loses the race cleanly.
    await expect(options.confirmTentative(ctx, r.reservation.id)).rejects.toMatchObject({ code: "BOOKING_LOCKED" });

    const released = await options.expireDueOptions({ propertyId });
    expect(released).toBeGreaterThanOrEqual(1);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: r.reservation.id } });
    expect(row.status).toBe("CANCELLED");
    expect(row.cancellationReasonCode).toBe(options.OPTION_EXPIRED);

    // Running it again changes nothing (idempotent).
    expect(await options.expireDueOptions({ propertyId })).toBe(0);

    // The room is free again.
    const again = await book(ctx, 10, 12);
    expect(again.ok).toBe(true);
    if (again.ok) await prisma.reservation.update({ where: { id: again.reservation.id }, data: { status: "CANCELLED" } });

    // …and the released one can be reinstated as tentative with a fresh option.
    const back = await options.reinstateAsTentative(ctx, r.reservation.id);
    expect(back?.status).toBe("TENTATIVE");
    expect(back?.optionDate && back.optionDate > new Date()).toBe(true);
    await prisma.reservation.update({ where: { id: r.reservation.id }, data: { status: "CANCELLED" } });
  });

  it("the lazy sweep on read releases expired options when the job is stopped", async () => {
    const ctx = await signIn(adminId);
    const r = await book(ctx, 20, 21, { status: "TENTATIVE" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await prisma.reservation.update({ where: { id: r.reservation.id }, data: { optionDate: new Date(Date.now() - 1000) } });
    options.resetOptionSweepThrottle();
    await options.expireOptionsSoon(propertyId);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.reservation.id } })).status).toBe("CANCELLED");
  });

  it("extending an option moves it, never past arrival", async () => {
    const ctx = await signIn(adminId);
    const r = await book(ctx, 30, 31, { status: "TENTATIVE" });
    if (!r.ok) throw new Error(r.error);
    const later = new Date(at(30).getTime() - 2 * DAY);
    const ext = await options.extendOption(ctx, r.reservation.id, later);
    expect(ext?.optionDate?.toISOString().slice(0, 10)).toBe(later.toISOString().slice(0, 10));
    await expect(options.extendOption(ctx, r.reservation.id, at(32))).rejects.toThrow(/past the arrival/);
    await options.releaseTentative(ctx, r.reservation.id, { reason: "test" });
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.reservation.id } })).status).toBe("CANCELLED");
  });

  it("confirming needs the option capability", async () => {
    const admin = await signIn(adminId);
    const r = await book(admin, 40, 41, { status: "TENTATIVE" });
    if (!r.ok) throw new Error(r.error);
    const limited = await signIn(limitedId);
    await expect(options.confirmTentative(limited, r.reservation.id)).rejects.toThrow(/does not allow/);
    await prisma.reservation.update({ where: { id: r.reservation.id }, data: { status: "CANCELLED" } });
  });

  it("two bookings for the last room at once: exactly one wins", async () => {
    const ctx = await signIn(adminId);
    const results = await Promise.all([book(ctx, 50, 52), book(ctx, 50, 52), book(ctx, 51, 53)]);
    const won = results.filter((r) => r.ok);
    expect(won).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) {
      if (!r.ok) expect(r.status).toBe(409);
    }
  });
});
