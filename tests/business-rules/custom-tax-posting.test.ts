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

const posChargeRoute = await import("@/app/api/pos/charge/route");
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

describe("Custom Tax profiles actually affect posted charges (pos/charge)", () => {
  let folioId: string;
  let defaultChargeCodeId: string;
  let customChargeCodeId: string;
  let adminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({
      where: { slug: "test-osta" },
      update: {},
      create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
    });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

    const enterprise = await prisma.enterprise.upsert({
      where: { slug: "test-custom-tax-enterprise" },
      update: {},
      create: { name: "Custom Tax Enterprise", slug: "test-custom-tax-enterprise", type: "STANDARD" },
    });

    await prisma.enterpriseSettings.upsert({
      where: { enterpriseId: enterprise.id },
      update: { serviceChargeEnabled: true, serviceChargeRate: 10, tgstEnabled: true, tgstRate: 17 },
      create: { enterpriseId: enterprise.id, serviceChargeEnabled: true, serviceChargeRate: 10, tgstEnabled: true, tgstRate: 17 },
    });

    const property = await prisma.property.create({
      data: {
        enterpriseId: enterprise.id, name: "Custom Tax Property", code: `CT-${Date.now()}`,
        legalName: "Custom Tax LLC", defaultCurrency: "USD", timeZone: "UTC",
        checkInTime: "14:00", checkOutTime: "11:00", pricesIncludeTaxes: false,
      },
    });

    const guest = await prisma.profile.create({
      data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Custom", lastName: "Tax" },
    });
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id, confirmationNo: `CT-${Date.now()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(), checkOutDate: new Date(Date.now() + 86400000), status: "IN_HOUSE",
        folios: { create: { folioNumber: 1, propertyId: property.id } },
      },
      include: { folios: true },
    });
    folioId = reservation.folios[0].id;

    // A charge code left on the default engine — proves it's unaffected by the
    // presence of custom profiles elsewhere in the enterprise.
    const defaultCode = await customChargeCode(enterprise.id, { code: "MB", description: "Minibar", useDefaultTax: true, subgroupCode: "20RV" });
    defaultChargeCodeId = defaultCode.id;

    // A multi-line Custom Tax profile (State Tax flat on subtotal, Local Fee compound
    // on subtotal + State Tax) linked to its own charge code.
    const taxProfile = await prisma.taxProfile.create({
      data: {
        enterpriseId: enterprise.id,
        name: "State + Local",
        rates: {
          create: [
            { name: "State Tax", ratePercent: 8, calculateOn: "BASE", order: 0, effectiveFrom: new Date() },
            { name: "Local Fee", ratePercent: 2, calculateOn: "COMPOUND", order: 1, effectiveFrom: new Date() },
          ],
        },
      },
    });
    const customCode = await customChargeCode(enterprise.id, { code: "SPA", description: "Spa Treatment", useDefaultTax: false, taxProfileId: taxProfile.id, subgroupCode: "60RV" });
    customChargeCodeId = customCode.id;

    const passwordHash = await bcrypt.hash("password123", 10);
    const admin = await prisma.user.create({
      data: {
        enterpriseId: enterprise.id, email: `ct-admin-${Date.now()}@test.local`, passwordHash,
        firstName: "Admin", lastName: "CT", roleId: roleIds["Admin"], scope: "ENTERPRISE",
      },
    });
    adminId = admin.id;
  });

  it("a charge code on the default engine gets Service Charge + GST", async () => {
    const res = await asUser(adminId, () =>
      posChargeRoute.POST(
        new Request("http://localhost/api/pos/charge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folioId, amount: 100, chargeCodeId: defaultChargeCodeId }),
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amount).toBe(100);
    expect(body.serviceChargeAmount).toBe(10);
    expect(body.taxAmount).toBe(18.7);
  });

  it("a charge code on a Custom Tax profile gets that profile's lines instead, not Service Charge + GST", async () => {
    const res = await asUser(adminId, () =>
      posChargeRoute.POST(
        new Request("http://localhost/api/pos/charge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folioId, amount: 100, chargeCodeId: customChargeCodeId }),
        })
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amount).toBe(100);
    expect(body.serviceChargeAmount).toBe(0);
    // State Tax 8% of 100 = 8; Local Fee 2% of (100 + 8) = 2.16; total = 10.16.
    expect(body.taxAmount).toBe(10.16);
  });
});
