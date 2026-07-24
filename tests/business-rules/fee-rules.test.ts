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

const depositRoute = await import("@/app/api/reservations/[id]/deposit/route");
const statusRoute = await import("@/app/api/reservations/[id]/status/route");
const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY = 86_400_000;

describe("Deposit / Cancellation / No-Show fee rules", () => {
  let enterpriseId: string;
  let propertyId: string;
  let paymentMethodId: string;
  let cxlCodeId: string;
  let nsfCodeId: string;
  let roomCodeId: string;
  let shiftId: string;
  let adminId: string;
  let guestId: string;

  const mkReserved = async (opts: { checkInOffset?: number; withDeposit?: number; cancellationFeeRuleId?: string; noShowFeeRuleId?: string } = {}) => {
    const checkIn = new Date(Date.now() + (opts.checkInOffset ?? 2) * DAY);
    const res = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `FR-${uniq()}`, primaryGuestId: guestId,
        checkInDate: checkIn, checkOutDate: new Date(checkIn.getTime() + 2 * DAY), status: "RESERVED", adults: 1,
        ...(opts.cancellationFeeRuleId ? { cancellationFeeRuleId: opts.cancellationFeeRuleId } : {}),
        ...(opts.noShowFeeRuleId ? { noShowFeeRuleId: opts.noShowFeeRuleId } : {}),
        ...(opts.withDeposit != null
          ? { folios: { create: { folioNumber: 1, propertyId, payments: { create: { paymentMethodId, shiftId, amount: opts.withDeposit, depositPurpose: "DEPOSIT" } } } } }
          : {}),
      },
      include: { folios: true },
    });
    return res;
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "Fee Rules", slug: `test-feerules-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({ data: { enterpriseId, name: "FR Prop", code: `FR-${uniq()}`, legalName: "FR LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", businessDate: new Date(Date.UTC(2026, 8, 1)) } });
    propertyId = property.id;
    const pm = await prisma.paymentMethod.create({ data: { enterpriseId, name: "Cash", type: "CASH" } });
    paymentMethodId = pm.id;
    cxlCodeId = (await prisma.chargeCode.create({ data: { enterpriseId, code: "CXL", description: "Cancellation Fee" } })).id;
    nsfCodeId = (await prisma.chargeCode.create({ data: { enterpriseId, code: "NSF", description: "No-Show Fee" } })).id;
    roomCodeId = (await prisma.chargeCode.create({ data: { enterpriseId, code: "ROOM", description: "Room Revenue" } })).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId, email: `fr-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "FR", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    adminId = admin.id;
    shiftId = (await prisma.cashierShift.create({ data: { enterpriseId, userId: admin.id, openingFloat: 0 } })).id;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Fee", lastName: "Rule" } });
    guestId = guest.upid;
  });

  it("deposit route tags the payment with its purpose", async () => {
    const res = await mkReserved();
    const resp = await asUser(adminId, () =>
      depositRoute.POST(
        new Request(`http://localhost/api/reservations/${res.id}/deposit`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ paymentMethodId, amount: 75, purpose: "PRE_ARRIVAL_FEE" }),
        }),
        { params: Promise.resolve({ id: res.id }) }
      )
    );
    expect(resp.status).toBe(201);
    const payment = await resp.json();
    expect(payment.depositPurpose).toBe("PRE_ARRIVAL_FEE");
  });

  it("cancellation with a selected flat rule posts the fee, retains the deposit, and reports the reconciliation", async () => {
    const rule = await prisma.propertyFeeRule.create({
      data: { propertyId, name: "Standard Cancellation", ruleType: "CANCELLATION", basis: "FLAT", value: 50, chargeCodeId: cxlCodeId, isActive: true },
    });
    const res = await mkReserved({ withDeposit: 30, cancellationFeeRuleId: rule.id });

    const resp = await asUser(adminId, () =>
      statusRoute.PATCH(
        new Request(`http://localhost/api/reservations/${res.id}/status`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }),
        }),
        { params: Promise.resolve({ id: res.id }) }
      )
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("CANCELLED");
    expect(body.cancellationFee.fee).toBe(50);
    expect(body.cancellationFee.depositHeld).toBe(30);
    expect(body.cancellationFee.shortfall).toBe(20);
    expect(body.cancellationFee.refundDue).toBe(0);

    // The fee is posted as a charge (retained against the deposit).
    const feeLine = await prisma.folioLineItem.findFirst({ where: { folio: { reservationId: res.id }, chargeCodeId: cxlCodeId } });
    expect(feeLine?.amount).toBe(50);
  });

  it("cancellation with no selected rule still requires a net-zero folio (deposit blocks)", async () => {
    const res = await mkReserved({ withDeposit: 20 }); // no cancellation rule selected → no fee
    const resp = await asUser(adminId, () =>
      statusRoute.PATCH(
        new Request(`http://localhost/api/reservations/${res.id}/status`, {
          method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "CANCELLED" }),
        }),
        { params: Promise.resolve({ id: res.id }) }
      )
    );
    expect(resp.status).toBe(400);
    expect((await resp.json()).error).toMatch(/unsettled balance/i);
  });

  it("no-show at Night Audit posts the selected-rule charge to a folio, creating one when needed", async () => {
    const rule = await prisma.propertyFeeRule.create({
      data: { propertyId, name: "Standard No-Show", ruleType: "NO_SHOW", basis: "FLAT", value: 40, chargeCodeId: nsfCodeId, isActive: true },
    });
    // Align the business date to today so the past-arrival no-shows qualify.
    const bizDate = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
    await prisma.property.update({ where: { id: propertyId }, data: { businessDate: bizDate } });

    const withDeposit = await mkReserved({ checkInOffset: -1, withDeposit: 60, noShowFeeRuleId: rule.id });
    const noFolio = await mkReserved({ checkInOffset: -1, noShowFeeRuleId: rule.id });

    const resp = await asUser(adminId, () =>
      nightAuditRunRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId }),
      }))
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();

    // The deposit-holding no-show got a charge posted to its existing folio.
    const feeLine = await prisma.folioLineItem.findFirst({ where: { folio: { reservationId: withDeposit.id }, chargeCodeId: nsfCodeId } });
    expect(feeLine?.amount).toBe(40);

    // The folio-less no-show now gets a folio CREATED with the charge posted to it.
    const noFolioReservation = await prisma.reservation.findUnique({ where: { id: noFolio.id }, include: { folios: { include: { lineItems: true } } } });
    expect(noFolioReservation!.status).toBe("NO_SHOW");
    expect(noFolioReservation!.folios.length).toBe(1);
    expect(noFolioReservation!.folios[0].lineItems.some((li) => li.chargeCodeId === nsfCodeId && li.amount === 40)).toBe(true);

    // Both are reported as charged; the deposit-less one is also flagged for collection.
    expect(body.noShowFeesCharged?.some((f: any) => f.confirmationNo === noFolio.confirmationNo && f.fee === 40)).toBe(true);
    expect(body.noShowFeesOwed?.some((f: any) => f.confirmationNo === noFolio.confirmationNo && f.fee === 40)).toBe(true);
  });
});
