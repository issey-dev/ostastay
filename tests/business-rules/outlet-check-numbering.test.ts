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

const posChargeRoute = await import("@/app/api/pos/charge/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Per-outlet sales-check numbering", () => {
  let propertyId: string;
  let enterpriseId: string;
  let adminId: string;
  let guestId: string;
  let spaOutletId: string;
  let barOutletId: string;
  let spaChargeCodeId: string;
  let barChargeCodeId: string;

  const postCharge = (body: Record<string, unknown>) =>
    asUser(adminId, () =>
      posChargeRoute.POST(
        new Request("http://localhost/api/pos/charge", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        })
      )
    );

  const mkReservationFolio = async () => {
    const res = await prisma.reservation.create({
      data: {
        propertyId, confirmationNo: `OC-${uniq()}`, primaryGuestId: guestId,
        checkInDate: new Date("2026-09-01"), checkOutDate: new Date("2026-09-03"), status: "IN_HOUSE", adults: 1,
        folios: { create: { folioNumber: 1, propertyId } },
      },
      include: { folios: true },
    });
    return res.folios[0].id;
  };

  const mkWalkInFolio = async () =>
    (await prisma.folio.create({ data: { propertyId, folioNumber: 1, walkInGuestName: "Passerby" } })).id;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "Outlet Check", slug: `test-outletcheck-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const property = await prisma.property.create({ data: { enterpriseId, name: "OC Prop", code: `OC-${uniq()}`, legalName: "OC LLC", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" } });
    propertyId = property.id;

    const spaCode = await prisma.chargeCode.create({ data: { enterpriseId, code: `SPA${uniq()}`, description: "Spa Service" } });
    spaChargeCodeId = spaCode.id;
    const barCode = await prisma.chargeCode.create({ data: { enterpriseId, code: `BAR${uniq()}`, description: "Bar Drink" } });
    barChargeCodeId = barCode.id;

    const spa = await prisma.outlet.create({ data: { propertyId, name: "Ocean Spa", code: "SPA", chargeCodes: { create: [{ chargeCodeId: spaChargeCodeId }] } } });
    spaOutletId = spa.id;
    const bar = await prisma.outlet.create({ data: { propertyId, name: "Sunset Bar", code: "BAR", chargeCodes: { create: [{ chargeCodeId: barChargeCodeId }] } } });
    barOutletId = bar.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({ data: { enterpriseId, email: `oc-admin-${uniq()}@test.local`, passwordHash, firstName: "Admin", lastName: "OC", roleId: roleIds["Admin"], scope: "ENTERPRISE" } });
    adminId = admin.id;
    const guest = await prisma.profile.create({ data: { enterpriseId, profileType: "GUEST", firstName: "Outlet", lastName: "Check" } });
    guestId = guest.upid;
  });

  it("opens a check numbered from the outlet code, and reuses it within a session", async () => {
    const folio = await mkReservationFolio();
    const first = await postCharge({ folioId: folio, chargeCodeId: spaChargeCodeId, amount: 50, outletId: spaOutletId });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.outletCheck?.checkNumber).toBe("SPA-00001");
    const checkId = firstBody.outletCheck.id;

    // Reusing the check id groups the next line under the same number.
    const second = await postCharge({ folioId: folio, chargeCodeId: spaChargeCodeId, amount: 20, outletId: spaOutletId, outletCheckId: checkId });
    const secondBody = await second.json();
    expect(secondBody.outletCheck.checkNumber).toBe("SPA-00001");
    expect(secondBody.outletCheckId).toBe(checkId);
  });

  it("increments per outlet independently", async () => {
    const folio = await mkReservationFolio();
    const spa = await (await postCharge({ folioId: folio, chargeCodeId: spaChargeCodeId, amount: 10, outletId: spaOutletId })).json();
    // Second spa check overall -> SPA-00002 (first test used SPA-00001).
    expect(spa.outletCheck.checkNumber).toBe("SPA-00002");
    const bar = await (await postCharge({ folioId: folio, chargeCodeId: barChargeCodeId, amount: 15, outletId: barOutletId })).json();
    expect(bar.outletCheck.checkNumber).toBe("BAR-00001");
  });

  it("ties a walk-in bill to one check and rejects a second outlet on it", async () => {
    const walkIn = await mkWalkInFolio();
    const first = await postCharge({ folioId: walkIn, chargeCodeId: spaChargeCodeId, amount: 40, outletId: spaOutletId });
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody.outletCheck.checkNumber).toMatch(/^SPA-/);

    // A different outlet on the same walk-in bill is rejected.
    const clash = await postCharge({ folioId: walkIn, chargeCodeId: barChargeCodeId, amount: 12, outletId: barOutletId });
    expect(clash.status).toBe(400);
    expect((await clash.json()).error).toMatch(/one outlet/i);

    // The same outlet, with no check id, reuses the walk-in's existing check.
    const same = await postCharge({ folioId: walkIn, chargeCodeId: spaChargeCodeId, amount: 8, outletId: spaOutletId });
    const sameBody = await same.json();
    expect(sameBody.outletCheckId).toBe(firstBody.outletCheck.id);
  });
});
