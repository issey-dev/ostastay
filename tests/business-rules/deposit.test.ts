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
const { summarizeShiftPayments, expectedCashForShift } = await import("@/lib/shift-summary");

const reservationsRoute = await import("@/app/api/reservations/route");
const depositRoute = await import("@/app/api/reservations/[id]/deposit/route");
const checkInRoute = await import("@/app/api/reservations/[id]/check-in/route");

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

describe("Pre-arrival deposits", () => {
  let enterpriseId: string;
  let propertyId: string;
  let roomTypeId: string;
  let roomId: string;
  let ratePlanId: string;
  let paymentMethodId: string;
  let adminId: string;
  let guestId: string;

  const book = (body: Record<string, unknown>) =>
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
            roomId,
            ...body,
          }),
        })
      )
    );

  const postDeposit = (id: string, body: Record<string, unknown>) =>
    asUser(adminId, () =>
      depositRoute.POST(
        new Request(`http://localhost/api/reservations/${id}/deposit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
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
      data: { name: "Deposit Test", slug: `test-deposit-${uniq()}`, type: "STANDARD" },
    });
    enterpriseId = enterprise.id;

    const property = await prisma.property.create({
      data: {
        enterpriseId,
        name: "Deposit Property",
        code: `DP-${uniq()}`,
        legalName: "Deposit LLC",
        defaultCurrency: "USD",
        timeZone: "UTC",
        checkInTime: "14:00",
        checkOutTime: "11:00",
      },
    });
    propertyId = property.id;

    const roomType = await prisma.roomType.create({
      data: { propertyId, name: "Deluxe", code: "DLX", maxOccupancy: 3 },
    });
    roomTypeId = roomType.id;
    const room = await prisma.room.create({
      data: { propertyId, roomTypeId, roomNumber: `D${Math.floor(Math.random() * 9000 + 1000)}`, status: "CLEAN" },
    });
    roomId = room.id;

    const ratePlan = await prisma.ratePlan.create({
      data: { propertyId, code: "BAR", name: "Best Available Rate" },
    });
    ratePlanId = ratePlan.id;

    const paymentMethod = await prisma.paymentMethod.create({
      data: { enterpriseId, name: "Cash", type: "CASH" },
    });
    paymentMethodId = paymentMethod.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId,
        email: `dp-admin-${uniq()}@test.local`,
        passwordHash,
        firstName: "Admin",
        lastName: "DP",
        roleId: roleIds["Admin"],
        scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;

    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Depo", lastName: "Sitter" },
    });
    guestId = guest.upid;
  });

  let reservationId: string;
  let depositFolioId: string;

  it("collects a deposit on a RESERVED booking onto the reservation's folio", async () => {
    const booked = await book({ checkInDate: "2026-09-01", checkOutDate: "2026-09-03" });
    expect(booked.status).toBe(201);
    reservationId = (await booked.json()).id;

    // Booking already provisions folio #1 — the deposit must reuse it, not add another.
    const foliosBefore = await prisma.folio.count({ where: { reservationId } });

    const res = await postDeposit(reservationId, { paymentMethodId, amount: 150, referenceNumber: "AUTH-1" });
    expect(res.status).toBe(201);
    const payment = await res.json();
    expect(payment.amount).toBe(150);

    const folios = await prisma.folio.findMany({ where: { reservationId }, include: { payments: true } });
    expect(folios).toHaveLength(Math.max(foliosBefore, 1));
    const depositFolio = folios.find((f) => f.payments.length > 0)!;
    expect(depositFolio.isClosed).toBe(false);
    expect(depositFolio.payments).toHaveLength(1);
    expect(depositFolio.payments[0].isRefund).toBe(false);
    depositFolioId = depositFolio.id;
  });

  it("rejects a non-positive or malformed deposit payload with 400", async () => {
    const zero = await postDeposit(reservationId, { paymentMethodId, amount: 0 });
    expect(zero.status).toBe(400);
    const missingMethod = await postDeposit(reservationId, { amount: 50 });
    expect(missingMethod.status).toBe(400);
  });

  it("check-in reuses the deposit folio (no duplicate) and returns its id", async () => {
    const res = await asUser(adminId, () =>
      checkInRoute.POST(new Request(`http://localhost/api/reservations/${reservationId}/check-in`, { method: "POST" }), {
        params: Promise.resolve({ id: reservationId }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.folioId).toBe(depositFolioId);

    // The deposit "transferred to the billing window" by virtue of being the same folio.
    expect(await prisma.folio.count({ where: { reservationId } })).toBe(1);
  });

  it("rejects deposits once the guest is in-house", async () => {
    const res = await postDeposit(reservationId, { paymentMethodId, amount: 50 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/before arrival/i);
  });
});

describe("Shift summary math", () => {
  const cash = { name: "Cash", type: "CASH" };
  const card = { name: "Visa", type: "CARD" };

  it("computes per-method breakdown with refunds netted", () => {
    const { byMethod } = summarizeShiftPayments([
      { amount: 100, isRefund: false, paymentMethod: cash },
      { amount: 40, isRefund: true, paymentMethod: cash },
      { amount: 250, isRefund: false, paymentMethod: card },
    ]);
    const cashRow = byMethod.find((r) => r.method === "Cash")!;
    const cardRow = byMethod.find((r) => r.method === "Visa")!;
    expect(cashRow.net).toBe(60);
    expect(cashRow.received).toBe(100);
    expect(cashRow.refunded).toBe(40);
    expect(cardRow.net).toBe(250);
  });

  it("expected cash counts only cash-type methods on top of the float", () => {
    const expected = expectedCashForShift(300, [
      { amount: 100, isRefund: false, paymentMethod: cash },
      { amount: 40, isRefund: true, paymentMethod: cash },
      { amount: 999, isRefund: false, paymentMethod: card },
    ]);
    expect(expected).toBe(360);
  });
});
