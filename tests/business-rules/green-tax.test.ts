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

const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

// Builds a fully checked-in reservation (property, room type, room, rate plan,
// assignment, open folio) under a fresh enterprise, plus an Admin user for it. Returns
// enough ids for a test to run night-audit and inspect the resulting folio.
async function setupCheckedInReservation(opts: {
  slug: string;
  adults: number;
  children: number;
  infants: number;
  chargeCodes: Array<{ code: string }>;
  settings?: { greenTaxEnabled: boolean; greenTaxAdultAmount?: number; greenTaxChildAmount?: number };
}) {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

  const enterprise = await prisma.enterprise.upsert({
    where: { slug: opts.slug },
    update: {},
    create: { name: opts.slug, slug: opts.slug, type: "STANDARD" },
  });

  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: `${opts.slug}-property`, code: `GT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      legalName: "Green Tax Test LLC", defaultCurrency: "USD", timeZone: "UTC",
      checkInTime: "14:00", checkOutTime: "11:00",
    },
  });

  const roomType = await prisma.roomType.create({
    data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 4 },
  });
  const room = await prisma.room.create({
    data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `10${Math.floor(Math.random() * 90 + 10)}` },
  });
  const ratePlan = await prisma.ratePlan.create({
    data: { propertyId: property.id, code: "STD", name: "Standard Rate" },
  });

  const guest = await prisma.profile.create({
    data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Green", lastName: "Tax" },
  });

  const today = new Date();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      confirmationNo: `GT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      primaryGuestId: guest.upid,
      checkInDate: new Date(today.getTime() - 86400000),
      checkOutDate: new Date(today.getTime() + 86400000),
      status: "IN_HOUSE",
      adults: opts.adults,
      children: opts.children,
      infants: opts.infants,
      assignments: {
        create: {
          roomTypeId: roomType.id,
          roomId: room.id,
          ratePlanId: ratePlan.id,
          overrideRate: 100,
          startDate: new Date(today.getTime() - 86400000),
          endDate: new Date(today.getTime() + 86400000),
        },
      },
      folios: { create: { folioNumber: 1, propertyId: property.id } },
    },
    include: { folios: true },
  });

  for (const cc of opts.chargeCodes) {
    await prisma.chargeCode.create({ data: { enterpriseId: enterprise.id, code: cc.code, description: cc.code } });
  }

  if (opts.settings) {
    await prisma.enterpriseSettings.upsert({
      where: { enterpriseId: enterprise.id },
      update: {
        greenTaxEnabled: opts.settings.greenTaxEnabled,
        ...(opts.settings.greenTaxAdultAmount !== undefined && { greenTaxAdultAmount: opts.settings.greenTaxAdultAmount }),
        ...(opts.settings.greenTaxChildAmount !== undefined && { greenTaxChildAmount: opts.settings.greenTaxChildAmount }),
      },
      create: {
        enterpriseId: enterprise.id,
        greenTaxEnabled: opts.settings.greenTaxEnabled,
        greenTaxAdultAmount: opts.settings.greenTaxAdultAmount ?? 12.0,
        greenTaxChildAmount: opts.settings.greenTaxChildAmount ?? 6.0,
      },
    });
  }

  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `gt-admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`,
      passwordHash, firstName: "Admin", lastName: "GT", roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });

  return { propertyId: property.id, folioId: reservation.folios[0].id, adminId: admin.id };
}

describe("Green Tax nightly posting (night-audit/run)", () => {
  it("posts adults*adultAmount + children*childAmount, excluding infants, when Green Tax is enabled", async () => {
    const { propertyId, folioId, adminId } = await setupCheckedInReservation({
      slug: "test-greentax-enabled",
      adults: 2,
      children: 1,
      infants: 1,
      chargeCodes: [{ code: "ROOM" }, { code: "GTX" }],
      settings: { greenTaxEnabled: true, greenTaxAdultAmount: 10, greenTaxChildAmount: 5 },
    });

    const res = await asUser(adminId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId }),
        })
      )
    );
    expect(res.status).toBe(200);

    const lineItems = await prisma.folioLineItem.findMany({
      where: { folioId },
      include: { chargeCode: true },
    });
    const gtxItem = lineItems.find((i) => i.chargeCode.code === "GTX");
    expect(gtxItem).toBeDefined();
    // 2 adults * $10 + 1 child * $5 = $25. The 1 infant contributes nothing.
    expect(gtxItem!.amount).toBe(25);
    expect(gtxItem!.taxAmount).toBe(0);
    expect(gtxItem!.serviceChargeAmount).toBe(0);
  });

  it("posts no Green Tax line item when disabled, and does not require a GTX charge code", async () => {
    const { propertyId, folioId, adminId } = await setupCheckedInReservation({
      slug: "test-greentax-disabled",
      adults: 2,
      children: 1,
      infants: 0,
      chargeCodes: [{ code: "ROOM" }], // deliberately no GTX code
      settings: { greenTaxEnabled: false },
    });

    const res = await asUser(adminId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId }),
        })
      )
    );
    expect(res.status).toBe(200);

    const lineItems = await prisma.folioLineItem.findMany({
      where: { folioId },
      include: { chargeCode: true },
    });
    expect(lineItems.some((i) => i.chargeCode.code === "GTX")).toBe(false);
  });

  it("400s with a clear error when Green Tax is enabled but no GTX charge code exists", async () => {
    const { propertyId, adminId } = await setupCheckedInReservation({
      slug: "test-greentax-missing-code",
      adults: 1,
      children: 0,
      infants: 0,
      chargeCodes: [{ code: "ROOM" }], // no GTX code, but Green Tax is enabled below
      settings: { greenTaxEnabled: true },
    });

    const res = await asUser(adminId, () =>
      nightAuditRunRoute.POST(
        new Request("http://localhost/api/night-audit/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId }),
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/GTX/);
  });
});
