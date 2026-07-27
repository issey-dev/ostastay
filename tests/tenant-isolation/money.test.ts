import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Same in-memory cookie-jar fake as tests/scope.test.ts.
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

const foliosRoute = await import("@/app/api/folios/route");
const folioPaymentsRoute = await import("@/app/api/folios/[id]/payments/route");
const posChargeRoute = await import("@/app/api/pos/charge/route");
const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

describe("Phase 4 tenant isolation: folios, payments, POS, night audit", () => {
  let propertyAId: string;
  let propertyBId: string;
  let adminAId: string;
  let cashierAId: string; // Front Desk role — no CASHIERING permission
  let reservationAId: string;
  let reservationBId: string;
  let folioAId: string;
  let folioBId: string;
  let chargeCodeAId: string;
  let paymentMethodAId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-p4-enterprise-a" },
      update: {},
      create: { name: "P4 Enterprise A", slug: "test-p4-enterprise-a", type: "STANDARD" },
    });
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-p4-enterprise-b" },
      update: {},
      create: { name: "P4 Enterprise B", slug: "test-p4-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "P4 Property A", code: `P4PA-${Date.now()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "P4 Property B", code: `P4PB-${Date.now()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyBId = propertyB.id;

    const guestA = await prisma.profile.create({
      data: { enterpriseId: enterpriseA.id, profileType: "GUEST", firstName: "Guest", lastName: "A" },
    });
    const guestB = await prisma.profile.create({
      data: { enterpriseId: enterpriseB.id, profileType: "GUEST", firstName: "Guest", lastName: "B" },
    });

    const reservationA = await prisma.reservation.create({
      data: {
        propertyId: propertyAId, confirmationNo: `P4A-${Date.now()}`, primaryGuestId: guestA.upid,
        checkInDate: new Date("2026-09-01"), checkOutDate: new Date("2026-09-03"), status: "IN_HOUSE",
        folios: { create: { folioNumber: 1, propertyId: propertyAId } },
      },
      include: { folios: true },
    });
    reservationAId = reservationA.id;
    folioAId = reservationA.folios[0].id;

    const reservationB = await prisma.reservation.create({
      data: {
        propertyId: propertyBId, confirmationNo: `P4B-${Date.now()}`, primaryGuestId: guestB.upid,
        checkInDate: new Date("2026-09-01"), checkOutDate: new Date("2026-09-03"), status: "IN_HOUSE",
        folios: { create: { folioNumber: 1, propertyId: propertyBId } },
      },
      include: { folios: true },
    });
    reservationBId = reservationB.id;
    folioBId = reservationB.folios[0].id;

    const chargeCodeA = await customChargeCode(enterpriseA.id, { code: "ROOM", description: "Room Rate", subgroupCode: "ROOM_REVENUE" });
    chargeCodeAId = chargeCodeA.id;

    const paymentMethodA = await prisma.paymentMethod.create({
      data: { enterpriseId: enterpriseA.id, name: "Cash", type: "CASH" },
    });
    paymentMethodAId = paymentMethodA.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `p4-admin-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const cashierA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `p4-cashier-a-${Date.now()}@test.local`, passwordHash,
        firstName: "NoCashier", lastName: "A", roleId: roleIds["Housekeeping"], scope: "ENTERPRISE",
      },
    });
    cashierAId = cashierA.id;
  });

  it("GET /api/folios 403s when the reservation belongs to a different enterprise's property", async () => {
    const res = await asUser(adminAId, () =>
      foliosRoute.GET(new Request(`http://localhost/api/folios?reservationId=${reservationBId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/folios succeeds for the actor's own reservation", async () => {
    const res = await asUser(adminAId, () =>
      foliosRoute.GET(new Request(`http://localhost/api/folios?reservationId=${reservationAId}`))
    );
    expect(res.status).toBe(200);
  });

  it("POST /api/folios/[id]/payments 403s against a different enterprise's folio", async () => {
    const res = await asUser(adminAId, () =>
      folioPaymentsRoute.POST(
        new Request(`http://localhost/api/folios/${folioBId}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentMethodId: paymentMethodAId, amount: 50 }),
        }),
        { params: Promise.resolve({ id: folioBId }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/folios/[id]/payments 403s for a role without CASHIERING permission", async () => {
    const res = await asUser(cashierAId, () =>
      folioPaymentsRoute.POST(
        new Request(`http://localhost/api/folios/${folioAId}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentMethodId: paymentMethodAId, amount: 50 }),
        }),
        { params: Promise.resolve({ id: folioAId }) }
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/folios/[id]/payments succeeds and auto-opens the caller's own cashier shift (never a client-supplied shiftId)", async () => {
    const res = await asUser(adminAId, () =>
      folioPaymentsRoute.POST(
        new Request(`http://localhost/api/folios/${folioAId}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentMethodId: paymentMethodAId, amount: 50, shiftId: "mock-shift-id" }),
        }),
        { params: Promise.resolve({ id: folioAId }) }
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.shift.userId).toBe(adminAId);
  });

  it("POST /api/pos/charge 404s when the charge code belongs to a different enterprise", async () => {
    const otherChargeCode = await prisma.chargeCode.create({
      data: { enterpriseId: (await prisma.property.findUniqueOrThrow({ where: { id: propertyBId } })).enterpriseId, code: "MB", description: "Minibar" },
    });
    const res = await asUser(adminAId, () =>
      posChargeRoute.POST(
        new Request("http://localhost/api/pos/charge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folioId: folioAId, amount: 20, chargeCodeId: otherChargeCode.id }),
        })
      )
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/pos/charge succeeds for the actor's own folio and charge code", async () => {
    const res = await asUser(adminAId, () =>
      posChargeRoute.POST(
        new Request("http://localhost/api/pos/charge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folioId: folioAId, amount: 20, chargeCodeId: chargeCodeAId }),
        })
      )
    );
    expect(res.status).toBe(200);
  });

  it("POST /api/night-audit/run 403s against a different enterprise's property", async () => {
    const res = await asUser(adminAId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyBId }),
        })
      )
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/night-audit/run succeeds for the actor's own property and records the real session user, not a client-supplied string", async () => {
    const res = await asUser(adminAId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId, executedBy: "Someone Else Entirely" }),
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.log.executedBy).not.toBe("Someone Else Entirely");
    expect(body.log.executedBy).toBe("Admin A");
  });
});
