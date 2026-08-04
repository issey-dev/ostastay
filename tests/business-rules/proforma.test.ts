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

const invoiceDataRoute = await import("@/app/api/folios/[id]/invoice-data/route");
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Proforma = full projected stay", () => {
  let enterpriseId: string;
  let propertyId: string;
  let folioId: string;
  let adminId: string;

  const invoiceData = (id: string, type: string) =>
    asUser(adminId, () =>
      invoiceDataRoute.GET(
        new Request(`http://localhost/api/folios/${id}/invoice-data?type=${type}`),
        { params: Promise.resolve({ id }) }
      )
    );

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "Proforma", slug: `test-proforma-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    await prisma.enterpriseSettings.create({ data: { enterpriseId, greenTaxEnabled: true, greenTaxAdultAmount: 12, greenTaxChildAmount: 6 } });
    const property = await prisma.property.create({ data: { enterpriseId, name: "PF", code: `PF-${uniq()}`, legalName: "PF LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } });
    propertyId = property.id;
    const roomType = await prisma.roomType.create({ data: { propertyId, name: "Deluxe", code: "DLX", maxOccupancy: 3, baseOccupancy: 2 } });
    const room = await prisma.room.create({ data: { propertyId, roomTypeId: roomType.id, roomNumber: `${Math.floor(Math.random() * 900 + 100)}`, status: "CLEAN" } });
    const ratePlan = await prisma.ratePlan.create({ data: { propertyId, code: "BAR", name: "BAR" } });
    await customChargeCode(enterpriseId, { code: "1000", description: "Room" });
    await customChargeCode(enterpriseId, { code: "8500", description: "Green Tax" });
    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId, email: `pf-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "PF", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" } });
    adminId = admin.id;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Pro", lastName: "Forma" } });

    // A 2-night stay priced via an override rate (no posted charges yet).
    const reservation = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `PF-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date("2026-09-01"), checkOutDate: new Date("2026-09-03"),
        status: "IN_HOUSE", adults: 2, children: 0,
        assignments: { create: { roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 150, startDate: new Date("2026-09-01"), endDate: new Date("2026-09-03") } },
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    folioId = reservation.folios[0].id;
  });

  it("proforma projects the full stay even with nothing posted; tax invoice shows posted (empty)", async () => {
    const proforma = await invoiceData(folioId, "proforma");
    expect(proforma.status).toBe(200);
    const pf = await proforma.json();
    expect(pf.documentType).toBe("proforma");
    expect(pf.folio.lineItems.length).toBeGreaterThan(0);

    // ONE LINE PER NIGHT (owner rule, 2026-08-03): a folio line carries a single date,
    // so the projection emits a room charge per night rather than one
    // "Accommodation (2 nights)" row stamped with the arrival date. Tax is attached at
    // group level, so each night's room line carries only its net and the Service
    // Charge / GST sit on their own lines against SVCACM / GSTACM — the same split a
    // real posting makes.
    const roomLines = pf.folio.lineItems.filter((l: any) => l.chargeCode.code === "1000");
    expect(roomLines).toHaveLength(2);
    const nightOf = (l: any) => String(l.date).slice(0, 10);
    expect(new Set(roomLines.map(nightOf))).toEqual(new Set(["2026-09-01", "2026-09-02"]));

    // Splitting by night must not change what is quoted: every room line plus the tax
    // it generates still totals the $300 the guest was quoted (2 × $150 gross).
    const roomGross = pf.folio.lineItems
      .filter((l: any) => roomLines.some((r: any) => l.id === r.id || l.generatedFromLineItemId === r.id))
      .reduce((sum: number, l: any) => sum + l.amount + l.taxAmount + l.serviceChargeAmount, 0);
    expect(roomGross).toBeCloseTo(300, 1);

    // Green Tax likewise lands per night — 2 adults × $12 = $24 a night, $48 the stay.
    const gtxLines = pf.folio.lineItems.filter((l: any) => l.chargeCode.code === "8500");
    expect(gtxLines).toHaveLength(2);
    expect(gtxLines.every((l: any) => Math.abs(l.amount - 24) < 0.05)).toBe(true);
    expect(gtxLines.reduce((s: number, l: any) => s + l.amount, 0)).toBeCloseTo(48, 1);

    // No line may span days: every projected line falls on one of the two nights.
    for (const l of pf.folio.lineItems) {
      expect(["2026-09-01", "2026-09-02"]).toContain(nightOf(l));
    }

    // No payments exist on this fixture. (A proforma no longer BLANKS payments — it
    // shows real ones, so a guest who paid a deposit sees it — there simply aren't any
    // here.)
    expect(pf.folio.payments.length).toBe(0);

    // Tax invoice = actually posted charges (none yet) — stays empty.
    const tax = await invoiceData(folioId, "tax");
    const tx = await tax.json();
    expect(tx.documentType).toBe("tax");
    expect(tx.folio.lineItems.length).toBe(0);
  });
});
