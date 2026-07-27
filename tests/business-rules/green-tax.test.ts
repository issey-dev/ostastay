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
const { ensureChargeTree } = await import("@/lib/posting/ensure-charge-tree");

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
  /** Seed the canonical charge tree (groups, system codes, the ROOM -> GTX generate)
   *  instead of the bare codes above — i.e. the shape a real onboarded property has. */
  seedTree?: boolean;
  /** Price today's night so an extra-occupancy surcharge posts alongside the room charge. */
  extraAdultPrice?: number;
  baseOccupancy?: number;
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
    data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 4, baseOccupancy: opts.baseOccupancy ?? 2 },
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

  if (opts.seedTree) {
    await ensureChargeTree(prisma, enterprise.id);
  } else {
    for (const cc of opts.chargeCodes) {
      await customChargeCode(enterprise.id, { code: cc.code, description: cc.code });
    }
  }

  // Today's calendar entry — only needed when a test wants an extra-occupancy surcharge,
  // which posts against the SAME accommodation code as the room charge (the case that
  // must not fire the nightly levies a second time).
  if (opts.extraAdultPrice !== undefined) {
    const auditDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    await prisma.priceCalendar.create({
      data: { ratePlanId: ratePlan.id, roomTypeId: roomType.id, date: auditDay, price: 100, extraAdultPrice: opts.extraAdultPrice },
    });
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
      chargeCodes: [{ code: "ROOM" }],
      settings: { greenTaxEnabled: true },
    });

    // chargeSubgroupId is required, so creating any code seeds the whole chart — which
    // includes GTX. Remove it explicitly to reach the guard: this is an enterprise whose
    // Green Tax code was deleted while the levy is still switched on.
    const prop = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    await prisma.chargeCodeGenerate.deleteMany({
      where: { generatedCode: { enterpriseId: prop.enterpriseId, code: "GTX" } },
    });
    await prisma.chargeCode.deleteMany({ where: { enterpriseId: prop.enterpriseId, code: "GTX" } });
    await prisma.enterpriseSettings.updateMany({
      where: { enterpriseId: prop.enterpriseId },
      data: { defaultGreenTaxChargeCodeId: null },
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

// The config-driven path: a property provisioned with the canonical charge tree posts
// Green Tax because ROOM declares a GREEN_TAX generate — not because Night Audit has a
// branch for it. Anything else the property declares posts the same way.
describe("Green Tax as a ChargeCodeGenerate (the seeded tree)", () => {
  it("posts Green Tax off the seeded ROOM -> GTX generate, with no hardcoded branch involved", async () => {
    const { propertyId, folioId, adminId } = await setupCheckedInReservation({
      slug: "test-greentax-generate",
      adults: 2, children: 0, infants: 0,
      chargeCodes: [],
      seedTree: true,
      settings: { greenTaxEnabled: true, greenTaxAdultAmount: 12, greenTaxChildAmount: 6 },
    });

    const res = await asUser(adminId, () =>
      nightAuditRunRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId }),
      }))
    );
    expect(res.status).toBe(200);

    const lines = await prisma.folioLineItem.findMany({ where: { folioId }, include: { chargeCode: true } });
    const gtx = lines.filter((l) => l.chargeCode.code === "GTX");
    expect(gtx).toHaveLength(1);
    expect(gtx[0].amount).toBe(24);
    expect(gtx[0].taxAmount).toBe(0);
    expect(gtx[0].serviceChargeAmount).toBe(0);
  });

  it("posts a property's own extra levy from config alone — no code change", async () => {
    const { propertyId, folioId, adminId } = await setupCheckedInReservation({
      slug: "test-greentax-custom-levy",
      adults: 2, children: 0, infants: 0,
      chargeCodes: [],
      seedTree: true,
      settings: { greenTaxEnabled: false },
    });

    // A municipal bed tax: $3 per person per night, declared entirely in Controls.
    const property = await prisma.property.findFirstOrThrow({ where: { id: propertyId } });
    const enterpriseId = property.enterpriseId;
    const levySubgroup = await prisma.chargeSubgroup.findUniqueOrThrow({
      where: { enterpriseId_code: { enterpriseId, code: "GOVERNMENT_LEVY" } },
    });
    const bedTax = await customChargeCode(enterpriseId, { code: "BEDTAX", description: "Municipal Bed Tax", chargeSubgroupId: levySubgroup.id, postingType: "TAX" });
    const room = await prisma.chargeCode.findUniqueOrThrow({ where: { enterpriseId_code: { enterpriseId, code: "ROOM" } } });
    await prisma.chargeCodeGenerate.create({
      data: {
        enterpriseId, generatorCodeId: room.id, generatedCodeId: bedTax.id,
        method: "PER_PERSON_PER_NIGHT", value: 3, calculateOn: "NET", sortOrder: 20,
      },
    });

    const res = await asUser(adminId, () =>
      nightAuditRunRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId }),
      }))
    );
    expect(res.status).toBe(200);

    const lines = await prisma.folioLineItem.findMany({ where: { folioId }, include: { chargeCode: true } });
    const levy = lines.filter((l) => l.chargeCode.code === "BEDTAX");
    expect(levy).toHaveLength(1);
    expect(levy[0].amount).toBe(6); // $3 * 2 pax * 1 night
    // A levy is posted at face value: never itself service-charged or GST'd.
    expect(levy[0].taxAmount).toBe(0);
    expect(levy[0].serviceChargeAmount).toBe(0);
    // Green Tax is off, so nothing from that generate.
    expect(lines.some((l) => l.chargeCode.code === "GTX")).toBe(false);
  });

  it("levies once per night even when an extra-occupancy line rides on the same room code", async () => {
    const { propertyId, folioId, adminId } = await setupCheckedInReservation({
      slug: "test-greentax-extra-occ",
      adults: 3, children: 0, infants: 0,
      chargeCodes: [],
      seedTree: true,
      baseOccupancy: 2,
      extraAdultPrice: 25,
      settings: { greenTaxEnabled: true, greenTaxAdultAmount: 12, greenTaxChildAmount: 6 },
    });

    const res = await asUser(adminId, () =>
      nightAuditRunRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId }),
      }))
    );
    expect(res.status).toBe(200);

    const lines = await prisma.folioLineItem.findMany({ where: { folioId }, include: { chargeCode: true } });
    // Both accommodation lines posted...
    expect(lines.filter((l) => l.description.startsWith("Extra Occupancy"))).toHaveLength(1);
    expect(lines.filter((l) => l.description === "Nightly Room Charge")).toHaveLength(1);
    // ...but the nightly levy fired exactly once, for 3 adults.
    const gtx = lines.filter((l) => l.chargeCode.code === "GTX");
    expect(gtx).toHaveLength(1);
    expect(gtx[0].amount).toBe(36);
  });
});

// Tax is attached at GROUP level: posting a charge code auto-posts its own group's
// Service Charge and GST codes. The amounts are NOT recomputed — the one default
// Maldives rule resolves them, and the generate only decides where they land — so a
// folio's total is identical whether tax sits in a line's columns or on its own line.
describe("group-level tax codes posted through generates", () => {
  it("posts Service Charge and GST as their own lines against the accommodation group's codes", async () => {
    const { propertyId, folioId, adminId } = await setupCheckedInReservation({
      slug: "test-tax-generates",
      adults: 1, children: 0, infants: 0,
      chargeCodes: [],
      seedTree: true,
      settings: { greenTaxEnabled: false },
    });

    const res = await asUser(adminId, () =>
      nightAuditRunRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId }),
      }))
    );
    expect(res.status).toBe(200);

    const lines = await prisma.folioLineItem.findMany({
      where: { folioId },
      include: { chargeCode: true, generatedFrom: { include: { chargeCode: true } } },
    });

    const room = lines.find((l) => l.chargeCode.code === "ROOM")!;
    const svc = lines.find((l) => l.chargeCode.code === "SVCACM");
    const gst = lines.find((l) => l.chargeCode.code === "GSTACM");
    expect(svc, "accommodation service charge line").toBeDefined();
    expect(gst, "accommodation GST line").toBeDefined();

    // The room line carries only its net — its tax moved onto the routed lines.
    expect(room.taxAmount).toBe(0);
    expect(room.serviceChargeAmount).toBe(0);

    // The default rule is unchanged: SVC 10% of net, GST 17% of (net + SVC). The
    // property is tax-inclusive by default, so $100 backs out to 77.70 / 7.77 / 14.53.
    expect(room.amount).toBeCloseTo(77.7, 2);
    expect(svc!.serviceChargeAmount).toBeCloseTo(7.77, 2);
    expect(gst!.taxAmount).toBeCloseTo(14.53, 2);

    // Each tax amount stays in the SAME column it occupied on the parent, so every
    // report that sums those columns is unaffected by the move.
    expect(svc!.amount).toBe(0);
    expect(svc!.taxAmount).toBe(0);
    expect(gst!.amount).toBe(0);
    expect(gst!.serviceChargeAmount).toBe(0);

    // The folio total is exactly the inclusive rate that was quoted.
    const folioTotal = lines.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0);
    expect(folioTotal).toBeCloseTo(100, 2);

    // And each tax line points back at the revenue that earned it, so reports can
    // attribute it to Room rather than stranding it under Tax.
    expect(svc!.generatedFrom?.chargeCode.code).toBe("ROOM");
    expect(gst!.generatedFrom?.chargeCode.code).toBe("ROOM");
  });

  it("keeps a tax line out of the GST base — a tax is never itself taxed", async () => {
    const { propertyId, folioId, adminId } = await setupCheckedInReservation({
      slug: "test-tax-not-taxed",
      adults: 1, children: 0, infants: 0,
      chargeCodes: [],
      seedTree: true,
      settings: { greenTaxEnabled: true, greenTaxAdultAmount: 12, greenTaxChildAmount: 6 },
    });

    await asUser(adminId, () =>
      nightAuditRunRoute.POST(new Request("http://localhost/api/night-audit/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId }),
      }))
    );

    const lines = await prisma.folioLineItem.findMany({ where: { folioId }, include: { chargeCode: true } });
    for (const l of lines.filter((x) => x.chargeCode.postingType === "TAX")) {
      // A tax/levy line never generates further tax of its own.
      const derived = lines.filter((x) => x.generatedFromLineItemId === l.id);
      expect(derived, `${l.chargeCode.code} generated ${derived.length} line(s)`).toHaveLength(0);
    }
    // Green Tax posts at face value alongside the routed SVC/GST.
    const gtx = lines.find((l) => l.chargeCode.code === "GTX")!;
    expect(gtx.amount).toBe(12);
    expect(gtx.taxAmount).toBe(0);
    expect(gtx.serviceChargeAmount).toBe(0);
  });
});
