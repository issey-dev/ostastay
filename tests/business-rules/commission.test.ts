import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";
import { calculateFolioCommission } from "@/lib/commission";

describe("calculateFolioCommission (pure math)", () => {
  it("attributes room revenue to the assignment's rate plan and applies its own commission rate", () => {
    const lineItems = [
      { amount: 100, isVoid: false, roomAssignmentId: "a1" },
      { amount: 20, isVoid: false, roomAssignmentId: "a1" }, // extra occupancy, same assignment
      { amount: 50, isVoid: false, roomAssignmentId: "a2" }, // different rate plan
      { amount: 999, isVoid: true, roomAssignmentId: "a1" }, // voided — excluded
      { amount: 30, isVoid: false, roomAssignmentId: null }, // not a room charge — excluded
    ];
    const assignments = [
      { id: "a1", ratePlanId: "rp1" },
      { id: "a2", ratePlanId: "rp2" },
    ];
    const rateLinks = [
      { ratePlanId: "rp1", commissionRate: 10 },
      { ratePlanId: "rp2", commissionRate: null }, // linked but no rate set — not eligible
    ];

    const { amount, breakdown } = calculateFolioCommission(lineItems, assignments, rateLinks);
    // rp1: (100 + 20) * 10% = 12. rp2: no rate, contributes 0.
    expect(amount).toBeCloseTo(12);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toMatchObject({ ratePlanId: "rp1", roomRevenue: 120, commissionRate: 10, commission: 12 });
  });

  it("returns zero when no rate plan has a commission rate linked", () => {
    const { amount, breakdown } = calculateFolioCommission(
      [{ amount: 100, isVoid: false, roomAssignmentId: "a1" }],
      [{ id: "a1", ratePlanId: "rp1" }],
      []
    );
    expect(amount).toBe(0);
    expect(breakdown).toHaveLength(0);
  });
});

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
const checkOutRoute = await import("@/app/api/reservations/[id]/check-out/route");

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

async function setup() {
  const osta = await prisma.enterprise.upsert({
    where: { slug: "test-osta" },
    update: {},
    create: { name: "Osta", slug: "test-osta", type: "INTERNAL" },
  });
  const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
  const enterprise = await prisma.enterprise.create({
    data: { name: "Commission Test", slug: `test-commission-${uniq()}`, type: "STANDARD" },
  });
  const property = await prisma.property.create({
    data: {
      enterpriseId: enterprise.id, name: "P", code: `CT-${uniq()}`, legalName: "P LLC",
      defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00",
    },
  });
  const roomType = await prisma.roomType.create({ data: { propertyId: property.id, name: "Standard", code: "STD", maxOccupancy: 2 } });
  const room = await prisma.room.create({ data: { propertyId: property.id, roomTypeId: roomType.id, roomNumber: `R${Math.floor(Math.random() * 9000 + 1000)}` } });
  const roomCode = await prisma.chargeCode.create({ data: { enterpriseId: enterprise.id, code: "ROOM", description: "Room Charge" } });
  const commissionCode = await prisma.chargeCode.create({ data: { enterpriseId: enterprise.id, code: "COMM", description: "TA Commission", category: "NON_REVENUE" } });
  const passwordHash = await bcrypt.hash("password123", 10);
  const admin = await prisma.user.create({
    data: {
      enterpriseId: enterprise.id, email: `comm-admin-${uniq()}@test.local`,
      passwordHash, firstName: "Admin", lastName: "C", roleId: roleIds["Admin"], scope: "ENTERPRISE",
    },
  });
  const guest = await prisma.profile.create({ data: { enterpriseId: enterprise.id, profileType: "GUEST", firstName: "Guest" } });
  const agent = await prisma.profile.create({
    data: { enterpriseId: enterprise.id, profileType: "TRAVEL_AGENT", firstName: "", companyName: "Comm Travel", isCreditAccount: true },
  });
  const ratePlan = await prisma.ratePlan.create({ data: { propertyId: property.id, code: "CORP", name: "Corporate Rate", isNegotiated: true } });

  return { enterpriseId: enterprise.id, propertyId: property.id, roomTypeId: roomType.id, roomId: room.id, roomCodeId: roomCode.id, commissionCodeId: commissionCode.id, adminId: admin.id, guestUpid: guest.upid, agentUpid: agent.upid, ratePlanId: ratePlan.id };
}

async function createInHouseCityLedgerReservation(ctx: Awaited<ReturnType<typeof setup>>) {
  const today = new Date();
  return prisma.reservation.create({
    data: {
      propertyId: ctx.propertyId,
      confirmationNo: `COMM-${uniq()}`,
      primaryGuestId: ctx.guestUpid,
      travelAgentId: ctx.agentUpid,
      checkInDate: new Date(today.getTime() - 86400000),
      checkOutDate: new Date(today.getTime() + 86400000),
      status: "IN_HOUSE",
      assignments: {
        create: {
          roomTypeId: ctx.roomTypeId, roomId: ctx.roomId, ratePlanId: ctx.ratePlanId, overrideRate: 100,
          startDate: new Date(today.getTime() - 86400000), endDate: new Date(today.getTime() + 86400000),
        },
      },
      folios: {
        create: { folioNumber: 1, propertyId: ctx.propertyId, settlementMethod: "CITY_LEDGER", payeeProfileId: ctx.agentUpid },
      },
    },
    include: { folios: true, assignments: true },
  });
}

describe("Travel Agent commission credit at checkout", () => {
  it("posts a negative commission credit line when the reservation's rate plan has a commission rate linked for the agent", async () => {
    const ctx = await setup();
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: ctx.ratePlanId, upid: ctx.agentUpid, commissionRate: 10 } });
    await prisma.enterpriseSettings.create({ data: { enterpriseId: ctx.enterpriseId, commissionChargeCodeId: ctx.commissionCodeId } });

    const reservation = await createInHouseCityLedgerReservation(ctx);
    await prisma.folioLineItem.create({
      data: {
        folioId: reservation.folios[0].id, chargeCodeId: ctx.roomCodeId, roomAssignmentId: reservation.assignments[0].id,
        amount: 200, taxAmount: 0, serviceChargeAmount: 0, description: "Nightly Room Charge", date: new Date(),
      },
    });

    const res = await asUser(ctx.adminId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
        params: Promise.resolve({ id: reservation.id }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commissionsPosted).toHaveLength(1);
    expect(body.commissionsPosted[0].amount).toBeCloseTo(20); // 200 * 10%

    const folio = await prisma.folio.findUnique({ where: { id: reservation.folios[0].id } });
    expect(folio!.isDebtorAccount).toBe(true);

    const commissionLine = await prisma.folioLineItem.findFirst({ where: { folioId: reservation.folios[0].id, chargeCodeId: ctx.commissionCodeId } });
    expect(commissionLine).not.toBeNull();
    expect(commissionLine!.amount).toBeCloseTo(-20);
  });

  it("posts nothing when no Commission charge code is configured, even with a commission rate linked", async () => {
    const ctx = await setup();
    await prisma.ratePlanAgentAccess.create({ data: { ratePlanId: ctx.ratePlanId, upid: ctx.agentUpid, commissionRate: 10 } });
    // No EnterpriseSettings row at all — commissionChargeCodeId is unset/disabled.

    const reservation = await createInHouseCityLedgerReservation(ctx);
    await prisma.folioLineItem.create({
      data: {
        folioId: reservation.folios[0].id, chargeCodeId: ctx.roomCodeId, roomAssignmentId: reservation.assignments[0].id,
        amount: 200, taxAmount: 0, serviceChargeAmount: 0, description: "Nightly Room Charge", date: new Date(),
      },
    });

    const res = await asUser(ctx.adminId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
        params: Promise.resolve({ id: reservation.id }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commissionsPosted).toHaveLength(0);

    const lineItems = await prisma.folioLineItem.findMany({ where: { folioId: reservation.folios[0].id } });
    expect(lineItems).toHaveLength(1); // only the original room charge, no commission line
  });

  it("posts nothing when the rate plan has no commission rate linked for this agent", async () => {
    const ctx = await setup();
    await prisma.enterpriseSettings.create({ data: { enterpriseId: ctx.enterpriseId, commissionChargeCodeId: ctx.commissionCodeId } });
    // No RatePlanAgentAccess row at all for this rate plan/agent pair.

    const reservation = await createInHouseCityLedgerReservation(ctx);
    await prisma.folioLineItem.create({
      data: {
        folioId: reservation.folios[0].id, chargeCodeId: ctx.roomCodeId, roomAssignmentId: reservation.assignments[0].id,
        amount: 200, taxAmount: 0, serviceChargeAmount: 0, description: "Nightly Room Charge", date: new Date(),
      },
    });

    const res = await asUser(ctx.adminId, () =>
      checkOutRoute.POST(new Request(`http://localhost/api/reservations/${reservation.id}/check-out`, { method: "POST" }), {
        params: Promise.resolve({ id: reservation.id }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commissionsPosted).toHaveLength(0);
  });
});
