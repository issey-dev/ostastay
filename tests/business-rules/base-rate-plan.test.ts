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

const propertiesRoute = await import("@/app/api/properties/route");
const ratePlansRoute = await import("@/app/api/rate-plans/route");
const ratePlansIdRoute = await import("@/app/api/rate-plans/[id]/route");
const nightAuditRunRoute = await import("@/app/api/night-audit/run/route");

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

async function setupProperty(slug: string) {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);

  const enterprise = await prisma.enterprise.create({
    data: { name: slug, slug: `${slug}-${uniq()}`, type: "STANDARD" },
  });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `${slug}-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: slug, roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });
  return { enterpriseId: enterprise.id, adminId: admin.id };
}

describe("Base Rate Plan: onboarding", () => {
  it("POST /api/properties auto-creates a locked BASE rate plan for the new property", async () => {
    const { adminId } = await setupProperty("test-brp-onboard");

    const res = await asUser(adminId, () =>
      propertiesRoute.POST(
        new Request("http://localhost/api/properties", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Onboard Test Property", code: `OBT-${uniq()}`, legalName: "Onboard LLC",
            defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
          }),
        })
      )
    );
    expect(res.status).toBe(201);
    const property = await res.json();

    const base = await prisma.ratePlan.findFirst({ where: { propertyId: property.id, code: "BASE" } });
    expect(base).not.toBeNull();
    expect(base!.isLocked).toBe(true);
    expect(base!.name).toBe("Base Rate");
  });
});

describe("Base Rate Plan: lock enforcement", () => {
  it("POST /api/rate-plans rejects code BASE as reserved", async () => {
    const { adminId, enterpriseId } = await setupProperty("test-brp-reserved");
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "P", code: `RC-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });

    const res = await asUser(adminId, () =>
      ratePlansRoute.POST(
        new Request("http://localhost/api/rate-plans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: property.id, code: "base", name: "Sneaky Base" }),
        })
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/reserved/i);
  });

  it("PUT ignores identity-field changes on a locked plan but still applies allocationIds", async () => {
    const { adminId, enterpriseId } = await setupProperty("test-brp-lockput");
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "P", code: `LP-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    const base = await prisma.ratePlan.create({
      data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
    });
    const chargeCode = await prisma.chargeCode.create({
      data: { enterpriseId, code: "BFC", description: "Breakfast" },
    });
    const allocation = await prisma.allocation.create({
      data: {
        propertyId: property.id, code: "BF", name: "Breakfast", chargeCodeId: chargeCode.id,
        rates: { create: { adultPrice: 10, childPrice: 5, effectiveFrom: new Date("2020-01-01") } },
      },
    });

    const res = await asUser(adminId, () =>
      ratePlansIdRoute.PUT(
        new Request(`http://localhost/api/rate-plans/${base.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: "HACKED", name: "Hacked Name", priority: 1, isNegotiated: true,
            allocationIds: [allocation.id],
          }),
        }),
        { params: Promise.resolve({ id: base.id }) }
      )
    );
    expect(res.status).toBe(200);

    const reloaded = await prisma.ratePlan.findUnique({
      where: { id: base.id },
      include: { allocationLinks: true },
    });
    // Identity fields untouched.
    expect(reloaded!.code).toBe("BASE");
    expect(reloaded!.name).toBe("Base Rate");
    expect(reloaded!.priority).toBe(999);
    expect(reloaded!.isNegotiated).toBe(false);
    // But the allocation link was applied.
    expect(reloaded!.allocationLinks.some((l) => l.allocationId === allocation.id)).toBe(true);
  });
});

describe("Rate Plan: Complimentary / House Use flags", () => {
  it("persists isComplimentary and isHouseUse through create and update, defaulting to false", async () => {
    const { adminId, enterpriseId } = await setupProperty("test-brp-comp");
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "P", code: `CH-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });

    const createRes = await asUser(adminId, () =>
      ratePlansRoute.POST(
        new Request("http://localhost/api/rate-plans", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ propertyId: property.id, code: "COMPTEST", name: "Comp Test", isComplimentary: true }),
        })
      )
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.isComplimentary).toBe(true);
    expect(created.isHouseUse).toBe(false); // not sent — defaults false, not undefined/omitted

    const updateRes = await asUser(adminId, () =>
      ratePlansIdRoute.PUT(
        new Request(`http://localhost/api/rate-plans/${created.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            code: created.code, name: created.name, priority: created.priority,
            isNegotiated: false, isComplimentary: false, isHouseUse: true,
          }),
        }),
        { params: Promise.resolve({ id: created.id }) }
      )
    );
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.isComplimentary).toBe(false);
    expect(updated.isHouseUse).toBe(true);
  });

  it("DELETE is blocked for a locked plan", async () => {
    const { adminId, enterpriseId } = await setupProperty("test-brp-lockdelete");
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "P", code: `LD-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    const base = await prisma.ratePlan.create({
      data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
    });

    const res = await asUser(adminId, () =>
      ratePlansIdRoute.DELETE(
        new Request(`http://localhost/api/rate-plans/${base.id}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: base.id }) }
      )
    );
    expect(res.status).toBe(400);
    expect(await prisma.ratePlan.findUnique({ where: { id: base.id } })).not.toBeNull();
  });
});

describe("Base Rate Plan: Night Audit fallback", () => {
  async function setupReservation(opts: {
    slug: string;
    basePlanPrice: number | null; // null = no Base Price Calendar entry at all
    assignedPlanPrice: number | null; // null = no entry under the assigned plan
    derivedFromAssigned?: { adjustmentType: string; adjustmentValue: number }; // makes the assigned plan derived from a third plan
  }) {
    const { adminId, enterpriseId } = await setupProperty(opts.slug);
    const property = await prisma.property.create({
      data: {
        enterpriseId, name: "P", code: `BRPF-${uniq()}`, legalName: "P LLC",
        defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
      },
    });
    const roomType = await prisma.roomType.create({
      data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 },
    });
    const room = await prisma.room.create({
      data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `${Math.floor(Math.random() * 900 + 100)}` },
    });
    const base = await prisma.ratePlan.create({
      data: { propertyId: property.id, code: "BASE", name: "Base Rate", priority: 999, isLocked: true },
    });

    let assignedPlan = base;
    if (opts.derivedFromAssigned) {
      const parent = await prisma.ratePlan.create({
        data: { propertyId: property.id, code: "PARENT", name: "Parent Plan" },
      });
      if (opts.assignedPlanPrice != null) {
        await prisma.priceCalendar.create({
          data: { ratePlanId: parent.id, roomTypeId: roomType.id, date: new Date(new Date().setHours(0, 0, 0, 0)), price: opts.assignedPlanPrice },
        });
      }
      assignedPlan = await prisma.ratePlan.create({
        data: {
          propertyId: property.id, code: "DERIVED", name: "Derived Plan",
          parentRatePlanId: parent.id,
          derivedAdjustmentType: opts.derivedFromAssigned.adjustmentType,
          derivedAdjustmentValue: opts.derivedFromAssigned.adjustmentValue,
        },
      });
    } else {
      assignedPlan = await prisma.ratePlan.create({
        data: { propertyId: property.id, code: "BAR", name: "Best Available" },
      });
      if (opts.assignedPlanPrice != null) {
        await prisma.priceCalendar.create({
          data: { ratePlanId: assignedPlan.id, roomTypeId: roomType.id, date: new Date(new Date().setHours(0, 0, 0, 0)), price: opts.assignedPlanPrice },
        });
      }
    }

    if (opts.basePlanPrice != null) {
      await prisma.priceCalendar.create({
        data: { ratePlanId: base.id, roomTypeId: roomType.id, date: new Date(new Date().setHours(0, 0, 0, 0)), price: opts.basePlanPrice },
      });
    }

    const roomCode = await prisma.chargeCode.create({
      data: { enterpriseId, code: "ROOM", description: "Room" },
    });
    void roomCode;

    const guest = await prisma.profile.create({
      data: { enterpriseId, profileType: "GUEST", firstName: "Guest", lastName: "Test" },
    });
    const today = new Date();
    const reservation = await prisma.reservation.create({
      data: {
        propertyId: property.id, confirmationNo: `BRPF-${uniq()}`, primaryGuestId: guest.upid,
        checkInDate: new Date(today.getTime() - DAY), checkOutDate: new Date(today.getTime() + DAY),
        status: "IN_HOUSE", adults: 1, children: 0,
        assignments: {
          create: {
            roomTypeId: roomType.id, roomId: room.id, ratePlanId: assignedPlan.id,
            startDate: new Date(today.getTime() - DAY), endDate: new Date(today.getTime() + DAY),
          },
        },
        folios: { create: { folioNumber: 1, propertyId: property.id } },
      },
      include: { folios: true },
    });

    return { propertyId: property.id, folioId: reservation.folios[0].id, adminId };
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

  async function roomChargeAmount(folioId: string) {
    const lines = await prisma.folioLineItem.findMany({
      where: { folioId, description: "Nightly Room Charge" },
    });
    return lines[0]?.amount;
  }

  it("falls back to the Base Rate plan's Price Calendar entry when the assigned plan has none", async () => {
    const { propertyId, folioId, adminId } = await setupReservation({
      slug: "test-brp-fallback",
      basePlanPrice: 175,
      assignedPlanPrice: null,
    });
    await runNightAudit(adminId, propertyId);
    expect(await roomChargeAmount(folioId)).toBe(175);
  });

  it("prefers the assigned plan's own Price Calendar entry over the Base fallback", async () => {
    const { propertyId, folioId, adminId } = await setupReservation({
      slug: "test-brp-prefer-assigned",
      basePlanPrice: 175,
      assignedPlanPrice: 200,
    });
    await runNightAudit(adminId, propertyId);
    expect(await roomChargeAmount(folioId)).toBe(200);
  });

  it("falls back to 0 when neither the assigned plan nor the Base plan has a Price Calendar entry", async () => {
    const { propertyId, folioId, adminId } = await setupReservation({
      slug: "test-brp-zero",
      basePlanPrice: null,
      assignedPlanPrice: null,
    });
    await runNightAudit(adminId, propertyId);
    expect(await roomChargeAmount(folioId)).toBe(0);
  });

  it("applies a derived plan's adjustment on top of the Base-plan-sourced fallback price", async () => {
    // Parent has no calendar entry either -> resolves through Base (175), then +20 flat.
    const { propertyId, folioId, adminId } = await setupReservation({
      slug: "test-brp-derived-fallback",
      basePlanPrice: 175,
      assignedPlanPrice: null,
      derivedFromAssigned: { adjustmentType: "FLAT", adjustmentValue: 20 },
    });
    await runNightAudit(adminId, propertyId);
    expect(await roomChargeAmount(folioId)).toBe(195);
  });
});
