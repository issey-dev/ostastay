import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { expandScheduleDates, combineDepartureDateTime, computeBookingTotal, rateForDate } from "@/lib/excursions";

// --- Pure-function unit tests (no DB, no session) ---

describe("excursions: pure helpers", () => {
  it("expandScheduleDates only returns the requested weekdays within range", () => {
    // 2026-07-20 is a Monday.
    const dates = expandScheduleDates("MON,WED", new Date(2026, 6, 20), new Date(2026, 6, 26));
    const days = dates.map((d) => d.getDay());
    expect(days.every((d) => d === 1 || d === 3)).toBe(true);
    expect(dates.length).toBe(2); // Mon 7/20, Wed 7/22 (next Mon 7/27 is out of range)
  });

  it("combineDepartureDateTime merges the date-only field with the HH:MM string", () => {
    const dt = combineDepartureDateTime(new Date(2026, 6, 22), "09:30");
    expect(dt.getFullYear()).toBe(2026);
    expect(dt.getMonth()).toBe(6);
    expect(dt.getDate()).toBe(22);
    expect(dt.getHours()).toBe(9);
    expect(dt.getMinutes()).toBe(30);
  });

  it("computeBookingTotal: PER_PERSON sums adult/child/infant, FLAT ignores headcount", () => {
    const rate = { adultPrice: 50, childPrice: 25, infantPrice: 5, flatPrice: 300 };
    expect(computeBookingTotal(rate, "PER_PERSON", { adultCount: 2, childCount: 1, infantCount: 1 })).toBe(2 * 50 + 25 + 5);
    expect(computeBookingTotal(rate, "FLAT", { adultCount: 4, childCount: 4, infantCount: 4 })).toBe(300);
  });

  it("rateForDate picks the row covering the date, preferring none over a stale range", () => {
    const rates = [
      { effectiveFrom: new Date(2020, 0, 1), effectiveTo: new Date(2025, 11, 31), price: "old" },
      { effectiveFrom: new Date(2026, 0, 1), effectiveTo: null, price: "current" },
    ];
    expect(rateForDate(rates, new Date(2026, 6, 22))?.price).toBe("current");
    expect(rateForDate(rates, new Date(2019, 0, 1))).toBeNull();
  });
});

// --- Route-level integration tests ---

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
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");

const typesRoute = await import("@/app/api/excursions/types/route");
const schedulesRoute = await import("@/app/api/excursions/schedules/route");
const generateRoute = await import("@/app/api/excursions/schedules/generate/route");
const bookingsRoute = await import("@/app/api/excursions/bookings/route");
const cancelBookingRoute = await import("@/app/api/excursions/bookings/[id]/cancel/route");
const noShowRoute = await import("@/app/api/excursions/bookings/[id]/no-show/route");
const cancelDepartureRoute = await import("@/app/api/excursions/departures/[id]/cancel/route");
const moveBookingsRoute = await import("@/app/api/excursions/departures/[id]/move-bookings/route");
const propertyModulesRoute = await import("@/app/api/licenses/property-modules/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
const dayStr = (d: Date) => d.toISOString().slice(0, 10);

describe("Excursions: business rules", () => {
  let ostaAdminId: string;
  let enterpriseId: string;
  let propertyId: string;
  let adminId: string;
  let limitedUserId: string; // EXCURSIONS full, but no CASHIERING at all
  let chargeCodeId: string;
  let excursionTypeId: string;
  let flatExcursionTypeId: string;
  let guestUpid: string;
  let reservationFolioId: string;
  let reservationId: string;

  const bookingsFor = (departureId: string) =>
    prisma.excursionBooking.findMany({ where: { departureId } });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const passwordHash = await bcrypt.hash("password123", 10);

    const ostaAdmin = await prisma.user.create({
      data: {
        enterpriseId: osta.id, email: `excursions-br-osta-${uniq()}@test.local`, passwordHash,
        firstName: "Osta", lastName: "Admin", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    ostaAdminId = ostaAdmin.id;

    const enterprise = await prisma.enterprise.create({
      data: { name: "Excursions BR", slug: `test-excursions-br-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "BR Property", code: `XBR-${uniq()}`, legalName: "BR LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    await asUser(ostaAdminId, () =>
      propertyModulesRoute.PATCH(
        new Request("http://localhost/api/licenses/property-modules", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId, module: "EXCURSIONS", enabled: true }),
        })
      )
    );

    const chargeCode = await prisma.chargeCode.create({
      data: { enterpriseId, code: "XBR", description: "Excursion BR Charge" },
    });
    chargeCodeId = chargeCode.id;

    const admin = await prisma.user.create({
      data: {
        enterpriseId, email: `excursions-br-admin-${uniq()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "BR", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    // A role with full EXCURSIONS access but nothing on CASHIERING at all — isolates
    // the "actor can cancel but can't void" branch, which no seeded system role does
    // (every role with EXCURSIONS today also has at least CASHIERING update).
    const limitedRole = await prisma.role.create({
      data: {
        enterpriseId, name: `Limited-${uniq()}`, isSystem: false,
        permissions: { create: [{ module: "EXCURSIONS", canView: true, canCreate: true, canUpdate: true, canDelete: true }] },
      },
    });
    const limitedUser = await prisma.user.create({
      data: {
        enterpriseId, email: `excursions-br-limited-${uniq()}@test.local`, passwordHash,
        firstName: "Limited", lastName: "User", roleId: limitedRole.id, scope: "ENTERPRISE",
      },
    });
    limitedUserId = limitedUser.id;

    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Excursion", lastName: "Guest" },
    });
    guestUpid = guest.upid;

    const reservation = await prisma.reservation.create({
      data: {
        propertyId, primaryGuestId: guestUpid, confirmationNo: `XBR-${uniq()}`,
        checkInDate: day(-1), checkOutDate: day(5), status: "IN_HOUSE",
        folios: { create: [{ propertyId, folioNumber: 1 }] },
      },
      include: { folios: true },
    });
    reservationId = reservation.id;
    reservationFolioId = reservation.folios[0].id;

    const typeRes = await asUser(adminId, () =>
      typesRoute.POST(
        new Request("http://localhost/api/excursions/types", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, code: "SNORK", name: "Snorkelling Trip", chargeCodeId,
            cutoffHours: 24,
            rates: [{ adultPrice: 50, childPrice: 25, infantPrice: 0, effectiveFrom: "2020-01-01" }],
          }),
        })
      )
    );
    excursionTypeId = (await typeRes.json()).id;

    const flatTypeRes = await asUser(adminId, () =>
      typesRoute.POST(
        new Request("http://localhost/api/excursions/types", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId, code: "CHARTER", name: "Private Charter", chargeCodeId, pricingMode: "FLAT",
            rates: [{ flatPrice: 300, effectiveFrom: "2020-01-01" }],
          }),
        })
      )
    );
    flatExcursionTypeId = (await flatTypeRes.json()).id;
  });

  const makeDeparture = (excursionTypeIdArg: string, offsetDays: number, time = "09:00", capacity = 10) =>
    prisma.excursionDeparture.create({
      data: { excursionTypeId: excursionTypeIdArg, departureDate: day(offsetDays), departureTime: time, capacity },
    });

  it("PER_PERSON pricing sums adult/child/infant against the active rate", async () => {
    const departure = await makeDeparture(excursionTypeId, 3);
    const res = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, reservationId, adultCount: 2, childCount: 1 }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.totalAmount).toBe(125); // 2*50 + 1*25
    const lineItem = await prisma.folioLineItem.findUnique({ where: { id: body.folioLineItemId } });
    expect(lineItem?.amount).toBe(125); // no EnterpriseSettings row → no tax
  });

  it("FLAT pricing ignores headcount", async () => {
    const departure = await makeDeparture(flatExcursionTypeId, 3);
    const res = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, reservationId, adultCount: 6, childCount: 2 }),
        })
      )
    );
    expect(res.status).toBe(201);
    expect((await res.json()).totalAmount).toBe(300);
  });

  it("booking requires exactly one of reservationId/folioId, never both or neither", async () => {
    const departure = await makeDeparture(excursionTypeId, 3);

    const neither = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, adultCount: 1 }),
        })
      )
    );
    expect(neither.status).toBe(400);

    const both = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, reservationId, folioId: reservationFolioId, adultCount: 1 }),
        })
      )
    );
    expect(both.status).toBe(400);

    const smuggled = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, folioId: reservationFolioId, adultCount: 1 }),
        })
      )
    );
    expect(smuggled.status).toBe(400);
    expect((await smuggled.json()).error).toMatch(/use reservationId instead/i);
  });

  it("cancelling past the cutoff requires EXCURSIONS delete; within it, update is enough", async () => {
    // Departed 2 days ago, well past a 24h cutoff.
    const pastDeparture = await makeDeparture(excursionTypeId, -2);
    const booked = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: pastDeparture.id, reservationId, adultCount: 1 }),
        })
      )
    );
    const bookingId = (await booked.json()).id;

    // limitedUserId has EXCURSIONS delete too (granted FULL above), so it can't isolate
    // the cutoff block on its own — use a second, delete-less role for that half.
    const noDeleteRole = await prisma.role.create({
      data: {
        enterpriseId, name: `NoDelete-${uniq()}`, isSystem: false,
        permissions: { create: [{ module: "EXCURSIONS", canView: true, canCreate: true, canUpdate: true, canDelete: false }] },
      },
    });
    const noDeleteUser = await prisma.user.create({
      data: {
        enterpriseId, email: `excursions-br-nodelete-${uniq()}@test.local`, passwordHash: await bcrypt.hash("password123", 10),
        firstName: "NoDelete", lastName: "User", roleId: noDeleteRole.id, scope: "ENTERPRISE",
      },
    });

    const blocked = await asUser(noDeleteUser.id, () =>
      cancelBookingRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test" }) }),
        { params: Promise.resolve({ id: bookingId }) }
      )
    );
    expect(blocked.status).toBe(403);

    const allowed = await asUser(adminId, () =>
      cancelBookingRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Manager override" }) }),
        { params: Promise.resolve({ id: bookingId }) }
      )
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).chargeVoided).toBe(true);
  });

  it("cancelling without CASHIERING access leaves the charge in place, with a clear note", async () => {
    const departure = await makeDeparture(excursionTypeId, 3); // within cutoff — no delete needed
    const booked = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, reservationId, adultCount: 1 }),
        })
      )
    );
    const body = await booked.json();

    const res = await asUser(limitedUserId, () =>
      cancelBookingRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test" }) }),
        { params: Promise.resolve({ id: body.id }) }
      )
    );
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.chargeVoided).toBe(false);
    expect(result.chargeNote).toMatch(/cashiering access is required/i);

    const lineItem = await prisma.folioLineItem.findUnique({ where: { id: body.folioLineItemId } });
    expect(lineItem?.isVoid).toBe(false);
  });

  it("a charge on a closed folio can never be voided by a cancellation", async () => {
    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 2, walkInGuestName: "Closed Bill Guest" } });
    const departure = await makeDeparture(excursionTypeId, 3);
    const booked = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, folioId: folio.id, adultCount: 1 }),
        })
      )
    );
    const body = await booked.json();
    await prisma.folio.update({ where: { id: folio.id }, data: { isClosed: true } });

    const res = await asUser(adminId, () =>
      cancelBookingRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test" }) }),
        { params: Promise.resolve({ id: body.id }) }
      )
    );
    const result = await res.json();
    expect(result.chargeVoided).toBe(false);
    expect(result.chargeNote).toMatch(/already closed/i);
  });

  it("no-show is rejected before the departure leaves and allowed after", async () => {
    const futureDeparture = await makeDeparture(excursionTypeId, 3);
    const futureBooked = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: futureDeparture.id, reservationId, adultCount: 1 }),
        })
      )
    );
    const futureBookingId = (await futureBooked.json()).id;
    const tooEarly = await asUser(adminId, () =>
      noShowRoute.POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: futureBookingId }) })
    );
    expect(tooEarly.status).toBe(400);

    const pastDeparture = await makeDeparture(excursionTypeId, -1);
    const pastBooked = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: pastDeparture.id, reservationId, adultCount: 1 }),
        })
      )
    );
    const pastBookingId = (await pastBooked.json()).id;
    const ok = await asUser(adminId, () => noShowRoute.POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: pastBookingId }) }));
    expect(ok.status).toBe(200);

    const again = await asUser(adminId, () => noShowRoute.POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: pastBookingId }) }));
    expect(again.status).toBe(400);
  });

  it("departure cancellation cascades, voids charges, and suggests only a genuinely future replacement", async () => {
    const cancelType = await prisma.excursionType.create({
      data: { propertyId, code: `CASC-${uniq().slice(-6)}`, name: "Cascade Test Trip", chargeCodeId, cutoffHours: 24 },
    });
    await prisma.excursionRate.create({ data: { excursionTypeId: cancelType.id, adultPrice: 50, childPrice: 0, infantPrice: 0, effectiveFrom: new Date(2020, 0, 1) } });

    const toCancel = await makeDeparture(cancelType.id, 2, "09:00");
    // Same excursion type, already departed (earlier today) — must NOT be suggested,
    // regressing the Phase 5 bug where date-only filtering missed the time of day.
    const alreadyDeparted = await makeDeparture(cancelType.id, 0, "00:00"); // effectively "just now or earlier"
    const genuineFuture = await makeDeparture(cancelType.id, 5, "09:00");

    const folio = await prisma.folio.create({ data: { propertyId, folioNumber: 3, walkInGuestName: "Cascade Walk-in" } });
    const bookingA = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: toCancel.id, reservationId, adultCount: 1 }),
        })
      )
    );
    const bookingB = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: toCancel.id, folioId: folio.id, adultCount: 1 }),
        })
      )
    );
    const bookingAId = (await bookingA.json()).id;
    const bookingBId = (await bookingB.json()).id;

    const cancelRes = await asUser(adminId, () =>
      cancelDepartureRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "Bad weather" }) }),
        { params: Promise.resolve({ id: toCancel.id }) }
      )
    );
    expect(cancelRes.status).toBe(200);
    const cancelBody = await cancelRes.json();
    expect(cancelBody.cancelledCount).toBe(2);
    expect(cancelBody.voidedCount).toBe(2);
    expect(cancelBody.suggestedReplacement?.id).toBe(genuineFuture.id);
    expect(cancelBody.suggestedReplacement?.id).not.toBe(alreadyDeparted.id);
    expect(new Set(cancelBody.movableBookingIds)).toEqual(new Set([bookingAId, bookingBId]));

    const bookings = await bookingsFor(toCancel.id);
    expect(bookings.every((b) => b.status === "CANCELLED")).toBe(true);

    // --- move-bookings: succeeds once, rejects a repeat move of the same booking ---
    const moveRes = await asUser(adminId, () =>
      moveBookingsRoute.POST(
        new Request("http://localhost", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetDepartureId: genuineFuture.id, bookingIds: [bookingAId, bookingBId] }),
        }),
        { params: Promise.resolve({ id: toCancel.id }) }
      )
    );
    const moveBody = await moveRes.json();
    expect(moveBody.moved.length).toBe(2);
    expect(moveBody.failed.length).toBe(0);

    const newBookings = await bookingsFor(genuineFuture.id);
    expect(newBookings.length).toBe(2);
    expect(newBookings.every((b) => b.movedFromDepartureId === toCancel.id)).toBe(true);

    const repeatMove = await asUser(adminId, () =>
      moveBookingsRoute.POST(
        new Request("http://localhost", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetDepartureId: alreadyDeparted.id, bookingIds: [bookingAId] }),
        }),
        { params: Promise.resolve({ id: toCancel.id }) }
      )
    );
    const repeatBody = await repeatMove.json();
    expect(repeatBody.moved.length).toBe(0);
    expect(repeatBody.failed[0].reason).toMatch(/already been moved/i);
  });

  it("a departure-cancel that can't void a charge (closed folio) marks it unmovable, and moving it anyway is rejected", async () => {
    const closedFolio = await prisma.folio.create({ data: { propertyId, folioNumber: 4, walkInGuestName: "Unmovable Guest", isClosed: false } });
    const departure = await makeDeparture(excursionTypeId, 2);
    const booked = await asUser(adminId, () =>
      bookingsRoute.POST(
        new Request("http://localhost/api/excursions/bookings", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ departureId: departure.id, folioId: closedFolio.id, adultCount: 1 }),
        })
      )
    );
    const bookingId = (await booked.json()).id;
    await prisma.folio.update({ where: { id: closedFolio.id }, data: { isClosed: true } });

    const replacement = await makeDeparture(excursionTypeId, 6);
    const cancelRes = await asUser(adminId, () =>
      cancelDepartureRoute.POST(
        new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test" }) }),
        { params: Promise.resolve({ id: departure.id }) }
      )
    );
    const cancelBody = await cancelRes.json();
    expect(cancelBody.movableBookingIds).not.toContain(bookingId);
    expect(cancelBody.unmovable.some((u: any) => u.bookingId === bookingId)).toBe(true);

    // Bypassing the client's own movable list and asking to move it anyway — the route
    // re-derives movability itself and must still refuse.
    const forcedMove = await asUser(adminId, () =>
      moveBookingsRoute.POST(
        new Request("http://localhost", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetDepartureId: replacement.id, bookingIds: [bookingId] }),
        }),
        { params: Promise.resolve({ id: departure.id }) }
      )
    );
    const forcedBody = await forcedMove.json();
    expect(forcedBody.moved.length).toBe(0);
    expect(forcedBody.failed[0].reason).toMatch(/double-charge/i);
  });

  it("generating departures twice for the same schedule/date range never duplicates", async () => {
    const genType = await prisma.excursionType.create({
      data: { propertyId, code: `GEN-${uniq().slice(-6)}`, name: "Generate Test", chargeCodeId },
    });
    await asUser(adminId, () =>
      schedulesRoute.POST(
        new Request("http://localhost/api/excursions/schedules", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ excursionTypeId: genType.id, daysOfWeek: "MON,WED,FRI", departureTime: "09:00", capacity: 10 }),
        })
      )
    );
    const through = dayStr(day(30));
    const first = await asUser(adminId, () =>
      generateRoute.POST(
        new Request("http://localhost/api/excursions/schedules/generate", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ excursionTypeId: genType.id, through }),
        })
      )
    );
    const firstBody = await first.json();
    expect(firstBody.created).toBeGreaterThan(0);

    const second = await asUser(adminId, () =>
      generateRoute.POST(
        new Request("http://localhost/api/excursions/schedules/generate", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ excursionTypeId: genType.id, through }),
        })
      )
    );
    const secondBody = await second.json();
    expect(secondBody.created).toBe(0);
    expect(secondBody.skipped).toBe(firstBody.created);
  });
});
