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

const lineItemsRoute = await import("@/app/api/folios/[id]/line-items/route");
const paymentsRoute = await import("@/app/api/folios/[id]/payments/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Folio posting rules: check-in gate, negatives, description/reference", () => {
  let enterpriseId: string;
  let propertyId: string;
  let chargeCodeId: string;
  let paymentMethodId: string;
  let adminId: string;
  let guestId: string;
  let roomTypeId: string;
  let ratePlanId: string;

  const postCharge = (folioId: string, body: Record<string, unknown>) =>
    asUser(adminId, () =>
      lineItemsRoute.POST(
        new Request(`http://localhost/api/folios/${folioId}/line-items`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: folioId }) }
      )
    );

  const postPayment = (folioId: string, body: Record<string, unknown>) =>
    asUser(adminId, () =>
      paymentsRoute.POST(
        new Request(`http://localhost/api/folios/${folioId}/payments`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: folioId }) }
      )
    );

  const mkReservationFolio = async (status: string) => {
    const res = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `FP-${uniq()}`, primaryGuestId: guestId,
        checkInDate: new Date("2026-09-01"), checkOutDate: new Date("2026-09-03"), status, adults: 1,
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    return res.folios[0].id;
  };

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "Folio Posting", slug: `test-foliopost-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({ data: { enterpriseId, name: "FP Prop", code: `FP-${uniq()}`, legalName: "FP LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } });
    propertyId = property.id;
    const roomType = await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } });
    roomTypeId = roomType.id;
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    ratePlanId = ratePlan.id;
    const chargeCode = await prisma.chargeCode.create({ data: { enterpriseId, code: "MINI", description: "Minibar" } });
    chargeCodeId = chargeCode.id;
    const pm = await prisma.paymentMethod.create({ data: { enterpriseId, name: "Cash", type: "CASH" } });
    paymentMethodId = pm.id;
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId, email: `fp-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "FP", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    adminId = admin.id;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Folio", lastName: "Post" } });
    guestId = guest.upid;
  });

  it("blocks charges on a RESERVED (not-yet-arrived) folio, allows once IN_HOUSE", async () => {
    const reservedFolio = await mkReservationFolio("RESERVED");
    const blocked = await postCharge(reservedFolio, { chargeCodeId, amount: 25 });
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toMatch(/checked in/i);

    const inHouseFolio = await mkReservationFolio("IN_HOUSE");
    const ok = await postCharge(inHouseFolio, { chargeCodeId, amount: 25 });
    expect(ok.status).toBe(201);
  });

  it("does not allow a fee to be posted as a charge on a RESERVED folio (fees go through Deposits)", async () => {
    const reservedFolio = await mkReservationFolio("RESERVED");
    const fee = await postCharge(reservedFolio, { chargeCodeId, amount: 40, description: "Cancellation fee" });
    expect(fee.status).toBe(400);
  });

  it("still accepts a deposit (payment) on a RESERVED folio", async () => {
    const reservedFolio = await mkReservationFolio("RESERVED");
    const res = await postPayment(reservedFolio, { paymentMethodId, amount: 100 });
    expect(res.status).toBe(201);
  });

  it("allows a negative charge (adjustment) but rejects zero", async () => {
    const folio = await mkReservationFolio("IN_HOUSE");
    const neg = await postCharge(folio, { chargeCodeId, amount: -15, description: "Goodwill adjustment" });
    expect(neg.status).toBe(201);
    expect((await neg.json()).amount).toBeLessThan(0);

    const zero = await postCharge(folio, { chargeCodeId, amount: 0 });
    expect(zero.status).toBe(400);
  });

  it("allows a negative/refund payment but rejects zero", async () => {
    const folio = await mkReservationFolio("IN_HOUSE");
    const refund = await postPayment(folio, { paymentMethodId, amount: 50, isRefund: true });
    expect(refund.status).toBe(201);
    const negative = await postPayment(folio, { paymentMethodId, amount: -20 });
    expect(negative.status).toBe(201);
    const zero = await postPayment(folio, { paymentMethodId, amount: 0 });
    expect(zero.status).toBe(400);
  });

  it("defaults the description to the charge code and stores a separate reference", async () => {
    const folio = await mkReservationFolio("IN_HOUSE");
    const res = await postCharge(folio, { chargeCodeId, amount: 30, reference: "PO-4471" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.description).toBe("Minibar"); // charge code description
    expect(body.reference).toBe("PO-4471");
  });
});
