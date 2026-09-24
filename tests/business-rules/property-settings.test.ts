import { describe, it, expect, vi, beforeAll } from "vitest";
import bcrypt from "bcryptjs";

// Each property has its own document content and booking-number format (PropertySettings,
// 2026-09-23 — .agents/docs/HUB_SETUP_PLAN.md, Phase 1). These tests pin the separation:
// a change at one property never shows at another, a single-property admin can only touch
// their own, and a customer can no longer write them at enterprise level.

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
const { getPropertySettings, PROPERTY_SETTINGS_DEFAULTS } = await import("@/lib/property-settings");
const { loadDocumentSettings } = await import("@/lib/document-settings");
const settingsRoute = await import("@/app/api/properties/[id]/settings/route");
const tenantSettingsRoute = await import("@/app/api/tenant-settings/route");

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try { return await fn(); } finally { await destroySession(); }
}

const patch = (userId: string, propertyId: string, body: unknown) =>
  asUser(userId, () =>
    settingsRoute.PATCH(
      new Request(`http://localhost/api/properties/${propertyId}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: propertyId }) }
    )
  );

describe("Per-property settings (stationery + booking number format)", () => {
  let enterpriseId: string;
  let beachId: string;
  let lagoonId: string;
  let adminId: string;
  let lagoonAdminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const enterprise = await prisma.enterprise.create({ data: { name: "PS", slug: `test-ps-${uniq()}`, type: "STANDARD" } });
    enterpriseId = enterprise.id;
    const make = (name: string) =>
      prisma.property.create({
        data: { enterpriseId, name, code: `PS-${uniq()}`, legalName: `${name} LLC`, defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00" },
      });
    beachId = (await make("Beach")).id;
    lagoonId = (await make("Lagoon")).id;
    const passwordHash = await bcrypt.hash("password123", 10);
    adminId = (await prisma.user.create({
      data: { enterpriseId, email: `ps-admin-${uniq()}@test.local`, passwordHash, firstName: "A", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
    })).id;
    lagoonAdminId = (await prisma.user.create({
      data: { enterpriseId, email: `ps-lagoon-${uniq()}@test.local`, passwordHash, firstName: "L", lastName: "A", roles: { create: { roleId: roleIds["Admin"] } }, scope: "PROPERTY", propertyId: lagoonId },
    })).id;
  });

  it("gives a property that never saved anything complete defaults", async () => {
    expect(await getPropertySettings(beachId)).toEqual(PROPERTY_SETTINGS_DEFAULTS);
  });

  it("keeps one property's stationery and booking format off every other property", async () => {
    const res = await patch(adminId, beachId, {
      invoiceFooterText: "Thank you for staying at Beach",
      invoicePaymentIban: "MV00BEACH",
      resConfirmPrefix: "VBR-",
      resConfirmLength: 5,
    });
    expect(res.status).toBe(200);

    const beach = await getPropertySettings(beachId);
    expect(beach.invoiceFooterText).toBe("Thank you for staying at Beach");
    expect(beach.invoicePaymentIban).toBe("MV00BEACH");
    expect(beach.resConfirmPrefix).toBe("VBR-");

    const lagoon = await getPropertySettings(lagoonId);
    expect(lagoon.invoiceFooterText).toBeNull();
    expect(lagoon.invoicePaymentIban).toBeNull();
    expect(lagoon.resConfirmPrefix).toBe("");
  });

  it("stores a cleared text field as null", async () => {
    await patch(adminId, beachId, { receiptTerms: "Keep this receipt" });
    const res = await patch(adminId, beachId, { receiptTerms: "   " });
    expect(res.status).toBe(200);
    expect((await getPropertySettings(beachId)).receiptTerms).toBeNull();
  });

  it("validates the payload — unknown fields and bad values are refused", async () => {
    expect((await patch(adminId, beachId, { resConfirmLength: 1 })).status).toBe(400);
    expect((await patch(adminId, beachId, { defaultFolioStyle: "fancy" })).status).toBe(400);
    expect((await patch(adminId, beachId, { smtpPassword: "x" })).status).toBe(400);
  });

  it("lets a single-property admin change their own property, never another", async () => {
    expect((await patch(lagoonAdminId, lagoonId, { statementTerms: "Lagoon terms" })).status).toBe(200);
    expect((await getPropertySettings(lagoonId)).statementTerms).toBe("Lagoon terms");

    const res = await patch(lagoonAdminId, beachId, { statementTerms: "Hijacked" });
    expect(res.status).toBe(403);
    expect((await getPropertySettings(beachId)).statementTerms).toBeNull();
  });

  it("refuses per-property fields at enterprise level for a customer enterprise", async () => {
    const res = await asUser(adminId, () =>
      tenantSettingsRoute.PATCH(
        new Request("http://localhost/api/tenant-settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invoiceFooterText: "Everywhere" }),
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("refuses posting defaults, payment methods and outlets that belong to another property", async () => {
    const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");
    await ensureChargeTree(prisma, { propertyId: lagoonId }, undefined, { demo: true });
    const lagoonRoom = await prisma.chargeCode.findUniqueOrThrow({ where: { propertyId_code: { propertyId: lagoonId, code: "1000" } } });
    const lagoonLedger = await prisma.paymentMethod.create({ data: { enterpriseId, propertyId: lagoonId, name: "CL", type: "CITY_LEDGER" } });
    const lagoonOutlet = await prisma.outlet.create({ data: { propertyId: lagoonId, name: "Lagoon Spa", code: `LS${uniq().slice(-4)}`, outletType: "SPA" } });

    // Each is Lagoon's — so Beach may not point at it.
    expect((await patch(adminId, beachId, { defaultAccommodationChargeCodeId: lagoonRoom.id })).status).toBe(400);
    expect((await patch(adminId, beachId, { cityLedgerPaymentMethodId: lagoonLedger.id })).status).toBe(400);
    expect((await patch(adminId, beachId, { spaOutletId: lagoonOutlet.id })).status).toBe(400);

    // ...while Lagoon itself may.
    const ok = await patch(adminId, lagoonId, {
      defaultAccommodationChargeCodeId: lagoonRoom.id,
      cityLedgerPaymentMethodId: lagoonLedger.id,
      spaOutletId: lagoonOutlet.id,
    });
    expect(ok.status).toBe(200);
    const lagoon = await getPropertySettings(lagoonId);
    expect(lagoon.spaOutletId).toBe(lagoonOutlet.id);
    expect((await getPropertySettings(beachId)).spaOutletId).toBeNull();
  });

  it("keeps tax switches and rates per property", async () => {
    expect((await patch(adminId, beachId, { tgstRate: 12, serviceChargeEnabled: false })).status).toBe(200);
    const beach = await getPropertySettings(beachId);
    const lagoon = await getPropertySettings(lagoonId);
    expect(beach.tgstRate).toBe(12);
    expect(beach.serviceChargeEnabled).toBe(false);
    expect(lagoon.tgstRate).toBe(17);
    expect(lagoon.serviceChargeEnabled).toBe(true);
    expect((await patch(adminId, beachId, { tgstRate: 150 })).status).toBe(400);
  });

  it("hands documents their property's content and never the SMTP/SFTP secrets", async () => {
    await prisma.enterpriseSettings.upsert({
      where: { enterpriseId },
      update: { smtpPassword: "secret", sftpPassword: "secret" },
      create: { enterpriseId, smtpPassword: "secret", sftpPassword: "secret" },
    });
    const doc = await loadDocumentSettings(beachId);
    expect(doc.invoiceFooterText).toBe("Thank you for staying at Beach");
    expect(doc).not.toHaveProperty("smtpPassword");
    expect(doc).not.toHaveProperty("sftpPassword");
    expect(doc).toHaveProperty("tgstRate");
  });
});
