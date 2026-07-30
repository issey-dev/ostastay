import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import bcrypt from "bcryptjs";

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

const mailerMock = { sendMail: vi.fn() };
vi.mock("@/lib/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mailer")>("@/lib/mailer");
  return { ...actual, sendMail: (...args: unknown[]) => mailerMock.sendMail(...args) };
});

const { prisma } = await import("@/lib/db");
const { createSession, destroySession } = await import("@/lib/auth");
const { SYSTEM_ROLE_DEFS, ensureRoles } = await import("../../prisma/rbac-seed-data");

const accountsRoute = await import("@/app/api/debtors/accounts/route");
const accountDetailRoute = await import("@/app/api/debtors/accounts/[profileId]/route");
const sendStatementRoute = await import("@/app/api/debtors/accounts/[profileId]/send-statement/route");
const reservationsRoute = await import("@/app/api/reservations/route");
const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");
const checkOutRoute = await import("@/app/api/reservations/[id]/check-out/route");
const paymentsRoute = await import("@/app/api/folios/[id]/payments/route");
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

describe("Debtors module: checkout-triggered invoice pipeline + tenant isolation", () => {
  let propertyAId: string;
  let enterpriseAId: string;
  let adminAId: string;
  let adminBId: string;
  let housekeepingAId: string;
  let roomTypeAId: string;
  let roomAId: string;
  let ratePlanAId: string;
  let creditAccountAId: string; // TRAVEL_AGENT, isCreditAccount: true, creditLimit: 500, enterprise A
  let creditAccountNoLimitId: string; // COMPANY, isCreditAccount: true, creditLimit: null
  let nonCreditProfileAId: string; // COMPANY, isCreditAccount: false
  let guestAId: string;
  let paymentMethodAId: string;

  beforeEach(() => {
    mailerMock.sendMail.mockReset();
  });

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterpriseA = await prisma.enterprise.upsert({
      where: { slug: "test-debtors-enterprise-a" },
      update: {},
      create: { name: "Debtors Enterprise A", slug: "test-debtors-enterprise-a", type: "STANDARD" },
    });
    enterpriseAId = enterpriseA.id;
    const enterpriseB = await prisma.enterprise.upsert({
      where: { slug: "test-debtors-enterprise-b" },
      update: {},
      create: { name: "Debtors Enterprise B", slug: "test-debtors-enterprise-b", type: "STANDARD" },
    });

    const propertyA = await prisma.property.create({
      data: {
        enterpriseId: enterpriseA.id, name: "Debtors Property A", code: `DBA-${Date.now()}`,
        legalName: "Property A LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    propertyAId = propertyA.id;

    const propertyB = await prisma.property.create({
      data: {
        enterpriseId: enterpriseB.id, name: "Debtors Property B", code: `DBB-${Date.now()}`,
        legalName: "Property B LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00",
      },
    });

    const roomTypeA = await prisma.roomType.create({
      data: { propertyId: propertyAId, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    roomTypeAId = roomTypeA.id;
    const roomA = await prisma.room.create({
      data: { propertyId: propertyAId, roomTypeId: roomTypeAId, roomNumber: `D${Math.floor(Math.random() * 9000 + 1000)}` },
    });
    roomAId = roomA.id;
    const ratePlanA = await prisma.ratePlan.create({
      data: { propertyId: propertyAId, code: "BAR", name: "Best Available Rate" },
    });
    ratePlanAId = ratePlanA.id;

    const roomCode = await customChargeCode(enterpriseA.id, { code: "1000", description: "Room Charge" });

    const paymentMethodA = await prisma.paymentMethod.create({
      data: { enterpriseId: enterpriseA.id, name: "Cash", type: "CASH" },
    });
    paymentMethodAId = paymentMethodA.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const adminA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `debtors-admin-a-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "A", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminAId = adminA.id;

    const housekeepingA = await prisma.user.create({
      data: {
        enterpriseId: enterpriseA.id, email: `debtors-hk-a-${Date.now()}@test.local`, passwordHash,
        firstName: "House", lastName: "Keeping", roleId: roleIds["Housekeeping"], scope: "ENTERPRISE",
      },
    });
    housekeepingAId = housekeepingA.id;

    const adminB = await prisma.user.create({
      data: {
        enterpriseId: enterpriseB.id, email: `debtors-admin-b-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "B", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminBId = adminB.id;

    const creditAccountA = await prisma.profile.create({
      data: {
        enterpriseId: enterpriseA.id, profileType: "TRAVEL_AGENT", firstName: "Sunny", lastName: "Travels",
        companyName: "Sunny Travels", isCreditAccount: true, creditLimit: 500, arNumber: "AR-1001",
        communications: { create: { type: "EMAIL", value: "billing@sunnytravels.test", isPrimary: true } },
      },
    });
    creditAccountAId = creditAccountA.upid;

    const creditAccountNoLimit = await prisma.profile.create({
      data: {
        enterpriseId: enterpriseA.id, profileType: "COMPANY", firstName: "Acme", lastName: "Corp",
        companyName: "Acme Corp", isCreditAccount: true, creditLimit: null,
      },
    });
    creditAccountNoLimitId = creditAccountNoLimit.upid;

    const nonCreditProfileA = await prisma.profile.create({
      data: { enterpriseId: enterpriseA.id, profileType: "COMPANY", firstName: "Regular", lastName: "Vendor", companyName: "Regular Vendor" },
    });
    nonCreditProfileAId = nonCreditProfileA.upid;

    const guestA = await prisma.profile.create({
      data: { enterpriseId: enterpriseA.id, profileType: "GUEST", firstName: "Guest", lastName: "A" },
    });
    guestAId = guestA.upid;

    void roomCode;
  });

  // Creates an IN_HOUSE reservation with one assigned room and one folio, mirroring
  // the shape reservations/route.ts + check-in produce. `overrideRate` drives the
  // folio's total when a charge is posted directly (tests bypass Night Audit for
  // checkout-focused scenarios to keep each test isolated to one behavior).
  async function createInHouseReservation(opts: {
    travelAgentId?: string | null;
    settlementMethod?: "DIRECT" | "CITY_LEDGER";
    payeeProfileId?: string | null;
  }) {
    const today = new Date();
    return prisma.reservation.create({
      data: {
        propertyId: propertyAId,
        confirmationNo: `CO-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        primaryGuestId: guestAId,
        travelAgentId: opts.travelAgentId ?? null,
        checkInDate: new Date(today.getTime() - 86400000),
        checkOutDate: new Date(today.getTime() + 86400000),
        status: "IN_HOUSE",
        assignments: {
          create: {
            roomTypeId: roomTypeAId, roomId: roomAId, ratePlanId: ratePlanAId, overrideRate: 150,
            startDate: new Date(today.getTime() - 86400000), endDate: new Date(today.getTime() + 86400000),
          },
        },
        folios: {
          create: {
            folioNumber: 1, propertyId: propertyAId,
            settlementMethod: opts.settlementMethod ?? "DIRECT",
            payeeProfileId: opts.payeeProfileId ?? null,
          },
        },
      },
      include: { folios: true },
    });
  }

  async function postCharge(folioId: string, amount: number) {
    const chargeCode = await prisma.chargeCode.findFirst({ where: { enterpriseId: enterpriseAId, code: "1000" } });
    return prisma.folioLineItem.create({
      data: { folioId, chargeCodeId: chargeCode!.id, amount, taxAmount: 0, serviceChargeAmount: 0, description: "Room Charge", date: new Date() },
    });
  }

  it("GET /api/debtors/accounts 403s for a role without DEBTORS permission", async () => {
    const res = await asUser(housekeepingAId, () =>
      accountsRoute.GET(new Request(`http://localhost/api/debtors/accounts?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/debtors/accounts only returns the caller's own enterprise's credit accounts", async () => {
    const res = await asUser(adminAId, () =>
      accountsRoute.GET(new Request(`http://localhost/api/debtors/accounts?propertyId=${propertyAId}`))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const upids = body.map((a: any) => a.upid);
    expect(upids).toContain(creditAccountAId);
    expect(upids).not.toContain(nonCreditProfileAId);
  });

  it("GET /api/debtors/accounts/[profileId] 404s for a profile that isn't an activated credit account", async () => {
    const res = await asUser(adminAId, () =>
      accountDetailRoute.GET(new Request(`http://localhost/api/debtors/accounts/${nonCreditProfileAId}?propertyId=${propertyAId}`), {
        params: Promise.resolve({ profileId: nonCreditProfileAId }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/debtors/accounts/[profileId] 403s when the property belongs to a different enterprise", async () => {
    const res = await asUser(adminBId, () =>
      accountDetailRoute.GET(new Request(`http://localhost/api/debtors/accounts/${creditAccountAId}?propertyId=${propertyAId}`), {
        params: Promise.resolve({ profileId: creditAccountAId }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/reservations defaults the initial folio's settlementMethod and payeeProfileId when the travel agent is a credit account", async () => {
    const res = await asUser(adminAId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId,
            primaryGuestId: guestAId,
            travelAgentId: creditAccountAId,
            checkInDate: "2026-10-01",
            checkOutDate: "2026-10-03",
            roomTypeId: roomTypeAId,
            ratePlanId: ratePlanAId,
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const folio = await prisma.folio.findFirst({ where: { reservationId: body.id } });
    expect(folio!.settlementMethod).toBe("CITY_LEDGER");
    expect(folio!.payeeProfileId).toBe(creditAccountAId);
    expect(folio!.isDebtorAccount).toBe(false);
  });

  it("POST /api/reservations defaults settlementMethod to DIRECT when no travel agent is attached", async () => {
    const res = await asUser(adminAId, () =>
      reservationsRoute.POST(
        new Request("http://localhost/api/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            propertyId: propertyAId,
            primaryGuestId: guestAId,
            checkInDate: "2026-10-05",
            checkOutDate: "2026-10-06",
            roomTypeId: roomTypeAId,
            ratePlanId: ratePlanAId,
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const folio = await prisma.folio.findFirst({ where: { reservationId: body.id } });
    expect(folio!.settlementMethod).toBe("DIRECT");
    expect(folio!.payeeProfileId).toBeNull();
  });

  it("Night Audit posts nightly charges to the reservation's own folio regardless of settlementMethod, and never to any shared account folio", async () => {
    const reservation = await createInHouseReservation({
      travelAgentId: creditAccountAId,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: creditAccountAId,
    });
    const ownFolioId = reservation.folios[0].id;

    const res = await asUser(adminAId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId }),
        })
      )
    );
    expect(res.status).toBe(200);

    const ownFolioItems = await prisma.folioLineItem.findMany({ where: { folioId: ownFolioId }, include: { chargeCode: true } });
    expect(ownFolioItems.some((i) => i.chargeCode.code === "1000" && i.description === "Nightly Room Charge")).toBe(true);

    // Still in-house — this City-Ledger folio must not have been finalized or
    // become visible in the Debtors module yet.
    const folioAfter = await prisma.folio.findUnique({ where: { id: ownFolioId } });
    expect(folioAfter!.isDebtorAccount).toBe(false);
  });

  it("an IN_HOUSE reservation's City-Ledger folio does not appear in the Debtors account detail route until checkout", async () => {
    const reservation = await createInHouseReservation({
      travelAgentId: creditAccountAId,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: creditAccountAId,
    });
    await postCharge(reservation.folios[0].id, 200);

    const res = await asUser(adminAId, () =>
      accountDetailRoute.GET(new Request(`http://localhost/api/debtors/accounts/${creditAccountAId}?propertyId=${propertyAId}`), {
        params: Promise.resolve({ profileId: creditAccountAId }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoices.some((inv: any) => inv.folioId === reservation.folios[0].id)).toBe(false);
  });

  it("checkout finalizes a CITY_LEDGER folio into a debtor invoice and succeeds despite a nonzero balance", async () => {
    const reservation = await createInHouseReservation({
      travelAgentId: creditAccountAId,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: creditAccountAId,
    });
    await postCharge(reservation.folios[0].id, 300);

    const res = await asUser(adminAId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
        params: Promise.resolve({ id: reservation.id }),
      })
    );
    expect(res.status).toBe(200);

    const folio = await prisma.folio.findUnique({ where: { id: reservation.folios[0].id } });
    expect(folio!.isClosed).toBe(true);
    expect(folio!.isDebtorAccount).toBe(true);
    expect(folio!.payeeProfileId).toBe(creditAccountAId);

    const updatedReservation = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    expect(updatedReservation!.status).toBe("CHECKED_OUT");
  });

  it("A10: two concurrent checkouts finalize the invoice once (no double commission)", async () => {
    const reservation = await createInHouseReservation({
      travelAgentId: creditAccountAId,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: creditAccountAId,
    });
    await postCharge(reservation.folios[0].id, 300);

    const doCheckout = () =>
      asUser(adminAId, () =>
        checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
          params: Promise.resolve({ id: reservation.id }),
        })
      );
    const [a, b] = await Promise.all([doCheckout(), doCheckout()]);

    // Exactly one run checks out; the other is rejected (409 guard, or a rolled-back
    // DB-lock error) — never a second checkout that could post commission twice.
    const okCount = [a, b].filter((r) => r.status === 200).length;
    expect(okCount).toBe(1);

    // No duplicate commission credit line on the finalized folio.
    const commissionLines = await prisma.folioLineItem.findMany({
      where: { folioId: reservation.folios[0].id, description: { contains: "Commission" } },
    });
    expect(commissionLines.length).toBeLessThanOrEqual(1);
  });

  it("checkout still blocks a DIRECT folio with a nonzero balance", async () => {
    const reservation = await createInHouseReservation({ settlementMethod: "DIRECT" });
    await postCharge(reservation.folios[0].id, 150);

    const res = await asUser(adminAId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
        params: Promise.resolve({ id: reservation.id }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/outstanding balance/i);

    const folio = await prisma.folio.findUnique({ where: { id: reservation.folios[0].id } });
    expect(folio!.isClosed).toBe(false);
  });

  it("checkout falls back to blocking a nonzero-balance folio when settlementMethod is CITY_LEDGER but travelAgentId isn't a valid credit account", async () => {
    const reservation = await createInHouseReservation({ settlementMethod: "CITY_LEDGER", travelAgentId: null });
    await postCharge(reservation.folios[0].id, 90);

    const res = await asUser(adminAId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
        params: Promise.resolve({ id: reservation.id }),
      })
    );
    expect(res.status).toBe(400);

    const folio = await prisma.folio.findUnique({ where: { id: reservation.folios[0].id } });
    expect(folio!.isDebtorAccount).toBe(false);
  });

  it("after checkout, the invoice appears on the Debtors account detail route with the correct guest name and total", async () => {
    const reservation = await createInHouseReservation({
      travelAgentId: creditAccountAId,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: creditAccountAId,
    });
    await postCharge(reservation.folios[0].id, 275);

    const checkoutRes = await asUser(adminAId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
        params: Promise.resolve({ id: reservation.id }),
      })
    );
    expect(checkoutRes.status).toBe(200);

    const res = await asUser(adminAId, () =>
      accountDetailRoute.GET(new Request(`http://localhost/api/debtors/accounts/${creditAccountAId}?propertyId=${propertyAId}`), {
        params: Promise.resolve({ profileId: creditAccountAId }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const invoice = body.invoices.find((inv: any) => inv.folioId === reservation.folios[0].id);
    expect(invoice).toBeTruthy();
    expect(invoice.guestName).toBe("Guest A");
    expect(invoice.total).toBe(275);
    expect(invoice.balance).toBe(275);
    expect(invoice.isOpen).toBe(true);
    expect(body.balance).toBeGreaterThanOrEqual(275);
  });

  it("recording a payment against one invoice's folio updates only that invoice's balance", async () => {
    const reservationOne = await createInHouseReservation({
      travelAgentId: creditAccountNoLimitId,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: creditAccountNoLimitId,
    });
    await postCharge(reservationOne.folios[0].id, 120);
    const reservationTwo = await createInHouseReservation({
      travelAgentId: creditAccountNoLimitId,
      settlementMethod: "CITY_LEDGER",
      payeeProfileId: creditAccountNoLimitId,
    });
    await postCharge(reservationTwo.folios[0].id, 80);

    for (const r of [reservationOne, reservationTwo]) {
      const res = await asUser(adminAId, () =>
        checkOutRoute.POST(new Request(`http://localhost/api/reservations/${r.id}/check-out`, { method: "POST" }), {
          params: Promise.resolve({ id: r.id }),
        })
      );
      expect(res.status).toBe(200);
    }

    const payRes = await asUser(adminAId, () =>
      paymentsRoute.POST(
        new Request(`http://localhost/api/folios/${reservationOne.folios[0].id}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentMethodId: paymentMethodAId, amount: 120 }),
        }),
        { params: Promise.resolve({ id: reservationOne.folios[0].id }) }
      )
    );
    expect(payRes.status).toBe(201);

    const res = await asUser(adminAId, () =>
      accountDetailRoute.GET(new Request(`http://localhost/api/debtors/accounts/${creditAccountNoLimitId}?propertyId=${propertyAId}`), {
        params: Promise.resolve({ profileId: creditAccountNoLimitId }),
      })
    );
    const body = await res.json();
    const invoiceOne = body.invoices.find((inv: any) => inv.folioId === reservationOne.folios[0].id);
    const invoiceTwo = body.invoices.find((inv: any) => inv.folioId === reservationTwo.folios[0].id);
    expect(invoiceOne.balance).toBe(0);
    expect(invoiceOne.isOpen).toBe(false);
    expect(invoiceTwo.balance).toBe(80);
    expect(invoiceTwo.isOpen).toBe(true);
  });

  it("POST send-statement 400s cleanly when the account has no email on file", async () => {
    const res = await asUser(adminAId, () =>
      sendStatementRoute.POST(
        new Request(`http://localhost/api/debtors/accounts/${creditAccountNoLimitId}/send-statement`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId }),
        }),
        { params: Promise.resolve({ profileId: creditAccountNoLimitId }) }
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no email address/i);
    expect(mailerMock.sendMail).not.toHaveBeenCalled();
  });

  it("POST send-statement sends to the account's email and returns success", async () => {
    mailerMock.sendMail.mockResolvedValueOnce(undefined);
    const res = await asUser(adminAId, () =>
      sendStatementRoute.POST(
        new Request(`http://localhost/api/debtors/accounts/${creditAccountAId}/send-statement`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: propertyAId }),
        }),
        { params: Promise.resolve({ profileId: creditAccountAId }) }
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sentTo).toBe("billing@sunnytravels.test");
    expect(mailerMock.sendMail).toHaveBeenCalledTimes(1);
  });
});
