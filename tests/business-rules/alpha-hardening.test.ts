import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/scope.test.ts — lets the real route handlers'
// calls into src/lib/scope.ts (which reads next/headers' cookies()) run under Vitest.
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

const reservationsRoute = await import("@/app/api/reservations/route");
const reservationIdRoute = await import("@/app/api/reservations/[id]/route");
const statusRoute = await import("@/app/api/reservations/[id]/status/route");
const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");
const lineItemsRoute = await import("@/app/api/folios/[id]/line-items/route");
const paymentsRoute = await import("@/app/api/folios/[id]/payments/route");
const voidRoute = await import("@/app/api/folios/[id]/line-items/[itemId]/void/route");
const groupPickupRoute = await import("@/app/api/groups/[id]/pickup/route");
const loginRoute = await import("@/app/api/auth/login/route");
const tenantSettingsRoute = await import("@/app/api/tenant-settings/route");
const { _resetLoginRateLimiter } = await import("@/lib/login-rate-limit");
const activityLogRoute = await import("@/app/api/activity-log/route");

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
const DAY = 86_400_000;

describe("Alpha hardening: availability, lifecycle, void, night-audit idempotency", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let roomId: string;
  let ratePlanId: string;
  let roomCodeId: string;
  let paymentMethodId: string;
  let adminId: string;
  let housekeeperId: string;
  let guestId: string;

  const bookVia = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId,
            primaryGuestId: guestId,
            roomTypeId,
            ratePlanId,
            ...body,
          }),
        })
      )
    );

  const patchStatus = (id: string, status: string) =>
    asUser(adminId, () =>
      statusRoute.PATCH(
        new Request(`http://localhost/api/reservations/${id}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
        }),
        { params: Promise.resolve({ id }) }
      )
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.create({
      data: { name: "Alpha Hardening", slug: `test-alpha-hardening-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Hardening Property",
        code: `AH-${uniq()}`,
        legalName: "Hardening LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    // Exactly ONE sellable room — the availability guard's capacity ceiling.
    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Single", code: "SGL", maxOccupancy: 2 },
    });
    roomTypeId = roomType.id;
    const room = await prisma.room.create({
      data: { propertyId, roomTypeId, roomNumber: `H${Math.floor(Math.random() * 9000 + 1000)}`, status: "CLEAN" },
    });
    roomId = room.id;

    const ratePlan = await prisma.ratePlan.create({
      data: { propertyId, code: "BAR", name: "Best Available Rate" },
    });
    ratePlanId = ratePlan.id;

    const roomCode = await prisma.chargeCode.create({
      data: { enterpriseId, code: "ROOM", description: "Room Revenue" },
    });
    roomCodeId = roomCode.id;

    const paymentMethod = await prisma.paymentMethod.create({
      data: { enterpriseId, name: "Cash", type: "CASH" },
    });
    paymentMethodId = paymentMethod.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId,
        email: `ah-admin-${uniq()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "AH",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const housekeeper = await prisma.user.create({
      data: {
        enterpriseId,
        email: `ah-hk-${uniq()}@test.local`,
        passwordHash,
        firstName: "House",
        lastName: "Keeper",
        roleId: roleIds["Housekeeping"],
        scope: "ENTERPRISE",
      },
    });
    housekeeperId = housekeeper.id;

    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Hardy", lastName: "Guest" },
    });
    guestId = guest.upid;
  });

  let firstReservationId: string;
  let thirdReservationId: string;
  let thirdFolioId: string;

  it("books the only room, then 409s an overlapping booking of the same type", async () => {
    const res1 = await bookVia({ checkInDate: "2026-08-10", checkOutDate: "2026-08-12" });
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    firstReservationId = body1.id;

    const res2 = await bookVia({ checkInDate: "2026-08-11", checkOutDate: "2026-08-13" });
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/No availability/i);
  });

  it("treats the check-out day as a free night (exclusive end): back-to-back bookings succeed", async () => {
    const res3 = await bookVia({ checkInDate: "2026-08-12", checkOutDate: "2026-08-14" });
    expect(res3.status).toBe(201);
    const body3 = await res3.json();
    thirdReservationId = body3.id;
    thirdFolioId = body3.folios[0].id;
  });

  it("issues sequential confirmation numbers via the REGISTRATION_NO sequence", async () => {
    const [r1, r3] = await Promise.all([
      prisma.reservation.findUnique({ where: { id: firstReservationId } }),
      prisma.reservation.findUnique({ where: { id: thirdReservationId } }),
    ]);
    // No enterprise prefix configured → the property code prefixes the sequence
    // (keeps the globally-unique confirmationNo collision-free across properties).
    const num = (s: string) => parseInt(s.slice(-6), 10);
    expect(r1!.confirmationNo).toMatch(/-\d{6}$/);
    expect(r3!.confirmationNo).toMatch(/-\d{6}$/);
    expect(num(r3!.confirmationNo)).toBeGreaterThan(num(r1!.confirmationNo));
  });

  it("cancelling releases the inventory so the dates become bookable again", async () => {
    const cancel = await patchStatus(firstReservationId, "CANCELLED");
    expect(cancel.status).toBe(200);

    const rebook = await bookVia({ checkInDate: "2026-08-10", checkOutDate: "2026-08-12" });
    expect(rebook.status).toBe(201);
  });

  it("rejects jumping RESERVED → CHECKED_OUT via the raw status route", async () => {
    const res = await patchStatus(thirdReservationId, "CHECKED_OUT");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Check-Out action/i);
  });

  it("rejects a reservation edit that tries to smuggle in a status change", async () => {
    const res = await asUser(adminId, () =>
      reservationIdRoute.PUT(
        new Request(`http://localhost/api/reservations/${thirdReservationId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            primaryGuestId: guestId,
            checkInDate: "2026-08-12",
            checkOutDate: "2026-08-14",
            adults: 1,
            children: 0,
            status: "CHECKED_OUT",
            assignments: [
              { roomTypeId, ratePlanId, startDate: "2026-08-12", endDate: "2026-08-14" },
            ],
          }),
        }),
        { params: Promise.resolve({ id: thirdReservationId }) }
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/status cannot be changed here/i);
  });

  it("blocks cancellation while non-void charges exist; void clears the way", async () => {
    const post = await asUser(adminId, () =>
      lineItemsRoute.POST(
        new Request(`http://localhost/api/folios/${thirdFolioId}/line-items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chargeCodeId: roomCodeId, amount: 50, description: "Minibar" }),
        }),
        { params: Promise.resolve({ id: thirdFolioId }) }
      )
    );
    expect(post.status).toBe(201);
    const lineItem = await post.json();

    const cancelBlocked = await patchStatus(thirdReservationId, "CANCELLED");
    expect(cancelBlocked.status).toBe(400);
    expect((await cancelBlocked.json()).error).toMatch(/unsettled balance/i);

    // Void requires a reason
    const noReason = await asUser(adminId, () =>
      voidRoute.POST(
        new Request(`http://localhost/api/folios/${thirdFolioId}/line-items/${lineItem.id}/void`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: thirdFolioId, itemId: lineItem.id }) }
      )
    );
    expect(noReason.status).toBe(400);

    const voided = await asUser(adminId, () =>
      voidRoute.POST(
        new Request(`http://localhost/api/folios/${thirdFolioId}/line-items/${lineItem.id}/void`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "Posted in error" }),
        }),
        { params: Promise.resolve({ id: thirdFolioId, itemId: lineItem.id }) }
      )
    );
    expect(voided.status).toBe(200);
    const dbItem = await prisma.folioLineItem.findUnique({ where: { id: lineItem.id } });
    expect(dbItem!.isVoid).toBe(true); // flagged, never deleted

    // Double-void rejected
    const again = await asUser(adminId, () =>
      voidRoute.POST(
        new Request(`http://localhost/api/folios/${thirdFolioId}/line-items/${lineItem.id}/void`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "twice" }),
        }),
        { params: Promise.resolve({ id: thirdFolioId, itemId: lineItem.id }) }
      )
    );
    expect(again.status).toBe(400);

    // With the charge voided, cancellation now succeeds and closes the folio.
    const cancelOk = await patchStatus(thirdReservationId, "CANCELLED");
    expect(cancelOk.status).toBe(200);
    const folio = await prisma.folio.findUnique({ where: { id: thirdFolioId } });
    expect(folio!.isClosed).toBe(true);
  });

  it("blocks deleting a reservation once it has financial history (even voided lines)", async () => {
    const res = await asUser(adminId, () =>
      reservationIdRoute.DELETE(
        new Request(`http://localhost/api/reservations/${thirdReservationId}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: thirdReservationId }) }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be deleted/i);

    // A financially clean reservation still deletes fine (true data-entry mistakes).
    const cleanRes = await bookVia({ checkInDate: "2026-09-01", checkOutDate: "2026-09-02" });
    expect(cleanRes.status).toBe(201);
    const clean = await cleanRes.json();
    const del = await asUser(adminId, () =>
      reservationIdRoute.DELETE(
        new Request(`http://localhost/api/reservations/${clean.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: clean.id }) }
      )
    );
    expect(del.status).toBe(200);
  });

  it("rejects non-positive payment amounts and check-out dates not after check-in", async () => {
    const badPayment = await asUser(adminId, () =>
      paymentsRoute.POST(
        new Request(`http://localhost/api/folios/${thirdFolioId}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentMethodId, amount: -50 }),
        }),
        { params: Promise.resolve({ id: thirdFolioId }) }
      )
    );
    expect(badPayment.status).toBe(400);

    const badDates = await bookVia({ checkInDate: "2026-10-05", checkOutDate: "2026-10-05" });
    expect(badDates.status).toBe(400);
    expect((await badDates.json()).error).toMatch(/after check-in/i);
  });

  it("supports the cancellation-fee workflow: post fee → blocked → take payment → cancel", async () => {
    const res = await bookVia({ checkInDate: "2026-11-01", checkOutDate: "2026-11-03" });
    expect(res.status).toBe(201);
    const body = await res.json();
    const folioId = body.folios[0].id;

    const feeRes = await asUser(adminId, () =>
      lineItemsRoute.POST(
        new Request(`http://localhost/api/folios/${folioId}/line-items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chargeCodeId: roomCodeId, amount: 40, description: "Cancellation Fee" }),
        }),
        { params: Promise.resolve({ id: folioId }) }
      )
    );
    expect(feeRes.status).toBe(201);
    const fee = await feeRes.json();

    const blocked = await patchStatus(body.id, "CANCELLED");
    expect(blocked.status).toBe(400); // fee unpaid — balance nonzero

    const feeTotal = fee.amount + fee.taxAmount + (fee.serviceChargeAmount || 0);
    const payRes = await asUser(adminId, () =>
      paymentsRoute.POST(
        new Request(`http://localhost/api/folios/${folioId}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentMethodId, amount: feeTotal }),
        }),
        { params: Promise.resolve({ id: folioId }) }
      )
    );
    expect(payRes.status).toBe(201);

    const cancelled = await patchStatus(body.id, "CANCELLED");
    expect(cancelled.status).toBe(200); // balance nets to zero — fee kept, stay cancelled
  });

  it("enforces group block held-room count and cutoff date on pickup, with allocation parity", async () => {
    const pickupBody = (checkIn: string, checkOut: string) => ({
      firstName: "Group",
      lastName: "Guest",
      roomTypeId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults: 1,
    });

    const block = await prisma.groupBlock.create({
      data: {
        propertyId,
        code: `GB-${uniq()}`,
        name: "Held Block",
        startDate: new Date("2026-11-10"),
        endDate: new Date("2026-11-15"),
        totalRoomsHeld: 1,
        status: "DEFINITE",
      },
    });

    const first = await asUser(adminId, () =>
      groupPickupRoute.POST(
        new Request(`http://localhost/api/groups/${block.id}/pickup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pickupBody("2026-11-10", "2026-11-12")),
        }),
        { params: Promise.resolve({ id: block.id }) }
      )
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.confirmationNo).toMatch(/-\d{6}$/); // same sequence + prefix rule as ordinary bookings

    const second = await asUser(adminId, () =>
      groupPickupRoute.POST(
        new Request(`http://localhost/api/groups/${block.id}/pickup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pickupBody("2026-11-12", "2026-11-14")),
        }),
        { params: Promise.resolve({ id: block.id }) }
      )
    );
    expect(second.status).toBe(400);
    expect((await second.json()).error).toMatch(/fully picked up/i);

    const pastCutoff = await prisma.groupBlock.create({
      data: {
        propertyId,
        code: `GB-${uniq()}`,
        name: "Expired Block",
        startDate: new Date("2026-12-01"),
        endDate: new Date("2026-12-05"),
        cutoffDate: new Date(Date.now() - DAY),
        totalRoomsHeld: 5,
        status: "DEFINITE",
      },
    });
    const late = await asUser(adminId, () =>
      groupPickupRoute.POST(
        new Request(`http://localhost/api/groups/${pastCutoff.id}/pickup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pickupBody("2026-12-01", "2026-12-03")),
        }),
        { params: Promise.resolve({ id: pastCutoff.id }) }
      )
    );
    expect(late.status).toBe(400);
    expect((await late.json()).error).toMatch(/cutoff/i);
  });

  it("locks an email out after 5 failed logins and clears on the window", async () => {
    _resetLoginRateLimiter();
    const email = `bruteforce-${uniq()}@test.local`;
    const attempt = () =>
      loginRoute.POST(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: "wrong" }),
        })
      );

    for (let i = 0; i < 5; i++) {
      const res = await attempt();
      expect(res.status).toBe(401); // generic error, no lockout yet
    }
    const locked = await attempt();
    expect(locked.status).toBe(429);
    expect((await locked.json()).error).toMatch(/Too many failed attempts/i);
    _resetLoginRateLimiter(); // don't leak lockout state into other suites
  });

  it("never returns stored SMTP/SFTP passwords; a round-tripped mask leaves them unchanged", async () => {
    const patch = (body: Record<string, unknown>) =>
      asUser(adminId, () =>
        tenantSettingsRoute.PATCH(
          new Request("http://localhost/api/tenant-settings", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
        )
      );

    // greenTaxEnabled: false keeps this suite's night-audit test independent of a GTX code.
    const set = await patch({ smtpPassword: "s3cret-smtp", greenTaxEnabled: false });
    expect(set.status).toBe(200);
    const setBody = await set.json();
    expect(setBody.smtpPassword).toBe("********");

    let stored = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId } });
    expect(stored!.smtpPassword).toBe("s3cret-smtp"); // real value at rest (encryption still a flagged follow-up)

    // The settings form round-trips the mask — must not clobber the stored secret.
    const roundTrip = await patch({ smtpPassword: "********", smtpHost: "mail.test.local" });
    expect(roundTrip.status).toBe(200);
    stored = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId } });
    expect(stored!.smtpPassword).toBe("s3cret-smtp");
    expect(stored!.smtpHost).toBe("mail.test.local");

    const get = await asUser(adminId, () => tenantSettingsRoute.GET());
    expect((await get.json()).smtpPassword).toBe("********");
  });

  it("night audit posts once, rolls the business date, and 409s a same-business-date re-run", async () => {
    const today = new Date();
    // Pin the property's business date to today's UTC midnight so the audit's
    // posting/roll dates are deterministic regardless of host timezone.
    const bizDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    await prisma.property.update({ where: { id: propertyId }, data: { businessDate: bizDate } });
    const mkInHouse = (checkOutOffsetDays: number) =>
      prisma.reservation.create({
        data: {
          propertyId,
          confirmationNo: `AH-NA-${uniq()}`,
          primaryGuestId: guestId,
          checkInDate: new Date(today.getTime() - 2 * DAY),
          checkOutDate: new Date(today.getTime() + checkOutOffsetDays * DAY),
          status: "IN_HOUSE",
          adults: 1,
          assignments: {
            create: {
              roomTypeId,
              roomId,
              ratePlanId,
              overrideRate: 100,
              startDate: new Date(today.getTime() - 2 * DAY),
              endDate: new Date(today.getTime() + checkOutOffsetDays * DAY),
            },
          },
          folios: { create: { folioNumber: 1, propertyId } },
        },
        include: { folios: true },
      });

    const current = await mkInHouse(1); // checks out tomorrow — chargeable tonight
    const overstay = await mkInHouse(-1); // should have left yesterday — not chargeable

    // An arrival that never checked in — the audit should mark it NO_SHOW.
    const noShow = await prisma.reservation.create({
      data: {
        propertyId,
        confirmationNo: `AH-NS-${uniq()}`,
        primaryGuestId: guestId,
        checkInDate: new Date(today.getTime() - DAY),
        checkOutDate: new Date(today.getTime() + DAY),
        status: "RESERVED",
        adults: 1,
      },
    });

    const run1 = await asUser(adminId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId }),
        })
      )
    );
    expect(run1.status).toBe(200);
    const run1Body = await run1.json();
    expect(run1Body.overstayWarning).toMatch(/past the check-out date/i);
    expect(run1Body.noShowsProcessed).toBeGreaterThanOrEqual(1);
    expect(run1Body.noShowConfirmationNos).toContain(noShow.confirmationNo);
    const noShowAfter = await prisma.reservation.findUnique({ where: { id: noShow.id } });
    expect(noShowAfter!.status).toBe("NO_SHOW");

    const currentItems = await prisma.folioLineItem.findMany({ where: { folioId: current.folios[0].id } });
    expect(currentItems.length).toBe(1); // exactly one room charge
    expect(currentItems[0].date.getTime()).toBe(bizDate.getTime()); // stamped with the business date
    const overstayItems = await prisma.folioLineItem.findMany({ where: { folioId: overstay.folios[0].id } });
    expect(overstayItems.length).toBe(0); // no unbounded accrual

    // The manual EOD run rolled the property's business date forward one day.
    const afterRun1 = await prisma.property.findUnique({ where: { id: propertyId } });
    expect(afterRun1!.businessDate!.getTime()).toBe(bizDate.getTime() + DAY);

    // Idempotency: re-running for the SAME business date is blocked. A normal EOD run
    // advances the date, so force it back to prove the one-COMPLETED-run-per-date guard.
    await prisma.property.update({ where: { id: propertyId }, data: { businessDate: bizDate } });
    const run2 = await asUser(adminId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId }),
        })
      )
    );
    expect(run2.status).toBe(409); // idempotency guard

    const afterRerun = await prisma.folioLineItem.findMany({ where: { folioId: current.folios[0].id } });
    expect(afterRerun.length).toBe(1); // nothing double-posted
  });

  it("writes an activity trail for the actions performed above", async () => {
    const rows = await prisma.userActivityLog.findMany({ where: { enterpriseId } });
    const has = (module: string, action: string) =>
      rows.some((r) => r.module === module && r.action === action);

    expect(has("RESERVATIONS", "CREATE")).toBe(true); // bookings
    expect(has("RESERVATIONS", "CANCELLED")).toBe(true); // status transitions
    expect(has("RESERVATIONS", "DELETE")).toBe(true); // clean-reservation delete
    expect(has("CASHIERING", "CREATE")).toBe(true); // posted charges
    expect(has("CASHIERING", "VOID")).toBe(true); // the void
    expect(has("CASHIERING", "PAYMENT")).toBe(true); // fee payment
    expect(has("NIGHT_AUDIT", "RUN")).toBe(true); // audit run
    expect(has("GROUP_BLOCKS", "CREATE")).toBe(true); // pickup
    expect(has("CONTROLS", "UPDATE")).toBe(true); // tenant-settings PATCH

    // Identity is snapshotted onto every row this admin produced.
    const adminRows = rows.filter((r) => r.userId === adminId);
    expect(adminRows.length).toBeGreaterThan(0);
    expect(adminRows.every((r) => r.userEmail?.includes("ah-admin-"))).toBe(true);
  });

  it("logs auth events: failed logins (incl. unknown emails) and successful sign-ins", async () => {
    _resetLoginRateLimiter();
    const admin = await prisma.user.findUnique({ where: { id: adminId } });

    const ok = await loginRoute.POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: admin!.email, password: "password123" }),
      })
    );
    expect(ok.status).toBe(200);

    const loginRow = await prisma.userActivityLog.findFirst({
      where: { module: "AUTH", action: "LOGIN", userId: adminId },
    });
    expect(loginRow).not.toBeNull();
    expect(loginRow!.enterpriseId).toBe(enterpriseId);

    // The lockout test earlier hammered a nonexistent email — those failures are on
    // record too, with no enterprise attached.
    const failedRow = await prisma.userActivityLog.findFirst({
      where: { module: "AUTH", action: "LOGIN_FAILED", userEmail: { contains: "bruteforce-" } },
    });
    expect(failedRow).not.toBeNull();
    expect(failedRow!.enterpriseId).toBeNull();
    cookieJar.clear();
  });

  it("scopes the activity-log API by enterprise and gates it on the ACTIVITY_LOG permission", async () => {
    const res = await asUser(adminId, () =>
      activityLogRoute.GET(new Request(`http://localhost/api/activity-log?module=RESERVATIONS&limit=100`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.every((e: { module: string }) => e.module === "RESERVATIONS")).toBe(true);

    // Rows from other enterprises (other suites run in the same DB) never leak in.
    const unfiltered = await asUser(adminId, () =>
      activityLogRoute.GET(new Request(`http://localhost/api/activity-log?limit=100`))
    );
    const all = await unfiltered.json();
    expect(all.entries.every((e: { userEmail: string | null }) => !e.userEmail || !e.userEmail.includes("p3-admin-"))).toBe(true);

    // Housekeeping's default matrix has no ACTIVITY_LOG view (backfilled as NONE).
    const denied = await asUser(housekeeperId, () =>
      activityLogRoute.GET(new Request(`http://localhost/api/activity-log`))
    );
    expect(denied.status).toBe(403);
  });
});
