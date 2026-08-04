import { describe, it, expect, vi } from "vitest";
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
const { customChargeCode, chargeCode, subgroupId, ensureChart } = await import("../helpers/charge-codes");

const DAY = 86400000;
const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  cookieJar.clear();
  await createSession(userId);
  try {
    return await fn();
  } finally {
    await destroySession();
  }
}

// Builds a checked-in reservation whose nightly room price comes from an overrideRate
// (so pricing is fixed), varying only which accommodation charge code should win. Seeds
// a "1000" legacy code, an "ACCOM" code, and optionally sets it as the plan's own code
// and/or the enterprise default.
async function setup(opts: {
  slug: string;
  planChargeCode: "ACCOM" | null;
  defaultChargeCode: "ACCOM" | null;
}) {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({
    data: { name: opts.slug, slug: `${opts.slug}-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `RCC-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const roomType = await prisma.roomType.create({
    data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 },
  });
  const room = await prisma.room.create({
    data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `${Math.floor(Math.random() * 900 + 100)}` },
  });

  // Legacy ROOM code always present as the last-resort fallback.
  await customChargeCode(enterprise.id, { code: "1000", description: "Room" });
  const accom = await customChargeCode(enterprise.id, { code: "ACCOM", description: "Accommodation", subgroupCode: "10RV" });

  const ratePlan = await prisma.ratePlan.create({
    data: {
      propertyId: property.id, code: "BAR", name: "Best Available",
      ...(opts.planChargeCode === "ACCOM" ? { chargeCodeId: accom.id } : {}),
    },
  });

  await prisma.enterpriseSettings.create({
    data: {
      enterpriseId: enterprise.id,
      greenTaxEnabled: false,
      ...(opts.defaultChargeCode === "ACCOM" ? { defaultAccommodationChargeCodeId: accom.id } : {}),
    },
  });

  const guest = await prisma.profile.create({
    data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "G", lastName: "T" },
  });
  const today = new Date();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id, confirmationNo: `RCC-${uniq()}`, primaryGuestId: guest.upid,
      checkInDate: new Date(today.getTime() - DAY), checkOutDate: new Date(today.getTime() + DAY),
      status: "IN_HOUSE", adults: 1, children: 0,
      assignments: {
        create: {
          roomTypeId: roomType.id, roomId: room.id, ratePlanId: ratePlan.id, overrideRate: 100,
          startDate: new Date(today.getTime() - DAY), endDate: new Date(today.getTime() + DAY),
        },
      },
      folios: { create: { folioNumber: 1, propertyId: property.id } },
    },
    include: { folios: true },
  });

  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `rcc-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "RCC", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE",
    },
  });

  return { propertyId: property.id, folioId: reservation.folios[0].id, adminId: admin.id };
}

async function roomChargeCode(folioId: string) {
  const line = await prisma.folioLineItem.findFirst({
    where: { folioId, description: "Nightly Room Charge" },
    include: { chargeCode: true },
  });
  return line?.chargeCode.code;
}

async function runNightAudit(adminId: string, propertyId: string) {
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
}

describe("Night Audit: room charge code resolution", () => {
  it("posts against the rate plan's own charge code when set", async () => {
    const { propertyId, folioId, adminId } = await setup({ slug: "test-rcc-plan", planChargeCode: "ACCOM", defaultChargeCode: null });
    await runNightAudit(adminId, propertyId);
    expect(await roomChargeCode(folioId)).toBe("ACCOM");
  });

  it("falls back to the enterprise default accommodation code when the plan has none", async () => {
    const { propertyId, folioId, adminId } = await setup({ slug: "test-rcc-default", planChargeCode: null, defaultChargeCode: "ACCOM" });
    await runNightAudit(adminId, propertyId);
    expect(await roomChargeCode(folioId)).toBe("ACCOM");
  });

  it("falls back to the legacy ROOM code when neither plan nor default is set", async () => {
    const { propertyId, folioId, adminId } = await setup({ slug: "test-rcc-legacy", planChargeCode: null, defaultChargeCode: null });
    await runNightAudit(adminId, propertyId);
    expect(await roomChargeCode(folioId)).toBe("1000");
  });
});
