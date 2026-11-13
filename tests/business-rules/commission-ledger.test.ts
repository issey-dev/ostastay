import { describe, it, expect, beforeAll, vi } from "vitest";
import bcrypt from "bcryptjs";

// Agent Portal plan Phase 7 (9.7.0): the commission ledger against §8's worked example —
// 75.00 including 10% service charge and 17% tax, 3 nights, 10% commission.

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
const { createSession } = await import("@/lib/auth");
const { requireSession } = await import("@/lib/scope");
const { ensureRoles, SYSTEM_ROLE_DEFS } = await import("../../prisma/rbac-seed-data");
const ledger = await import("@/lib/commission-ledger");
const { serverToday } = await import("@/lib/business-date");
const { ensureChart } = await import("../helpers/charge-codes");

describe("commissionByPlan (pure, §8)", () => {
  // The room-charge line's amount is stored without service charge and tax: 75 / 1.1 / 1.17.
  const nightly = Math.round((75 / 1.1 / 1.17) * 100) / 100; // 58.28
  const lines = [1, 2, 3].map(() => ({ amount: nightly, isVoid: false, roomAssignmentId: "a1" }));
  const assignments = [{ id: "a1", ratePlanId: "p1" }];

  it("base is the posted room amounts; commission is rounded once, half-up", () => {
    const [row] = ledger.commissionByPlan(lines, assignments, [{ id: "p1", isComplimentary: false, isHouseUse: false, linkRate: 10 }], null);
    expect(row.baseAmount).toBe(174.84);
    expect(row.amount).toBe(17.48);
  });
  it("the plan link's rate wins; the profile's rate is the fallback; complimentary earns nothing", () => {
    expect(ledger.commissionByPlan(lines, assignments, [{ id: "p1", isComplimentary: false, isHouseUse: false, linkRate: null }], 5)[0].amount).toBe(8.74);
    expect(ledger.commissionByPlan(lines, assignments, [{ id: "p1", isComplimentary: true, isHouseUse: false, linkRate: 10 }], 10)).toEqual([]);
  });
  it("void lines and lines that are not room charges are not commissionable", () => {
    const mixed = [...lines, { amount: 500, isVoid: true, roomAssignmentId: "a1" }, { amount: 80, isVoid: false, roomAssignmentId: null }];
    expect(ledger.commissionByPlan(mixed, assignments, [{ id: "p1", isComplimentary: false, isHouseUse: false, linkRate: 10 }], null)[0].amount).toBe(17.48);
  });
});

describe("Commission ledger at check-out", () => {
  const stamp = Date.now();
  let chargeCodeId: string;
  let propertyId: string, sourceId: string, planId: string, guestId: string, roomTypeId: string, adminId: string;

  beforeAll(async () => {
    const osta = await prisma.enterprise.upsert({ where: { slug: "test-osta" }, update: {}, create: { name: "Osta", slug: "test-osta", type: "INTERNAL" } });
    const roleIds = await ensureRoles(prisma, osta.id, SYSTEM_ROLE_DEFS, true);
    const ent = await prisma.enterprise.create({ data: { name: `Com ${stamp}`, slug: `test-com-${stamp}`, type: "STANDARD" } });
    propertyId = (
      await prisma.property.create({
        data: { enterpriseId: ent.id, name: "Com", code: `COM-${stamp}`, legalName: "L", defaultCurrency: "USD", timeZone: "UTC", checkInTime: "14:00", checkOutTime: "11:00", status: "ACTIVE", businessDate: serverToday() },
      })
    ).id;
    roomTypeId = (await prisma.roomType.create({ data: { propertyId, name: "Std", code: "STD", maxOccupancy: 2 } })).id;
    await ensureChart({ propertyId });
    chargeCodeId = (await prisma.chargeCode.findFirstOrThrow({ where: { propertyId } })).id;
    planId = (await prisma.ratePlan.create({ data: { propertyId, code: "NEG", name: "Contract", isNegotiated: true } })).id;
    sourceId = (await prisma.profile.create({ data: { enterpriseId: ent.id, firstName: "S", companyName: "Sun Tours", profileType: "SOURCE", commissionRate: 10, settlementMode: "GUEST_DIRECT" } })).upid;
    guestId = (await prisma.profile.create({ data: { enterpriseId: ent.id, firstName: "G", lastName: "X", profileType: "GUEST" } })).upid;
    adminId = (
      await prisma.user.create({
        data: { enterpriseId: ent.id, email: `com-${stamp}@test.local`, passwordHash: await bcrypt.hash("x", 4), firstName: "A", lastName: "D", roles: { create: { roleId: roleIds["Admin"] } }, scope: "ENTERPRISE" },
      })
    ).id;
  });

  async function checkedOutStay(mode: string) {
    const r = await prisma.reservation.create({
      data: {
        propertyId, primaryGuestId: guestId, confirmationNo: `C${stamp}${Math.random().toString(36).slice(2, 6)}`, status: "CHECKED_OUT",
        sourceProfileId: sourceId, settlementMode: mode, checkInDate: serverToday(), checkOutDate: new Date(serverToday().getTime() + 3 * 86_400_000),
        assignments: { create: { roomTypeId, ratePlanId: planId, startDate: serverToday(), endDate: new Date(serverToday().getTime() + 3 * 86_400_000) } },
      },
      include: { assignments: true },
    });
    const folio = await prisma.folio.create({ data: { reservationId: r.id, propertyId, folioNumber: 1 } });
    for (let i = 0; i < 3; i++) {
      await prisma.folioLineItem.create({
        data: { folioId: folio.id, chargeCodeId, description: "Nightly Room Charge", amount: 58.28, taxAmount: 10.9, serviceChargeAmount: 5.83, roomAssignmentId: r.assignments[0].id, date: serverToday() },
      });
    }
    // Green Tax and an extra on the same folio: never commissionable.
    await prisma.folioLineItem.create({ data: { folioId: folio.id, chargeCodeId, description: "Green Tax", amount: 18, date: serverToday() } });
    return r.id;
  }

  it("guest pays at the hotel → ACCRUED, owed to the agent; reversal reverses it", async () => {
    const id = await checkedOutStay("GUEST_DIRECT");
    const rows = await ledger.recordCommissionAtCheckout(id, []);
    expect(rows).toHaveLength(1);
    const row = await prisma.agentCommission.findFirstOrThrow({ where: { reservationId: id } });
    expect(row).toMatchObject({ status: "ACCRUED", mode: "GUEST_DIRECT", baseAmount: 174.84, amount: 17.48, profileId: sourceId });
    // Idempotent.
    expect(await ledger.recordCommissionAtCheckout(id, [])).toEqual([]);
    await ledger.reverseCommissionAtCheckout(id);
    expect((await prisma.agentCommission.findFirstOrThrow({ where: { reservationId: id } })).status).toBe("REVERSED");
  });

  it("agent pays net and the invoice already carries the credit → NETTED", async () => {
    const id = await checkedOutStay("AGENT_NET");
    await ledger.recordCommissionAtCheckout(id, [{ folioId: "f", amount: 17.48 }]);
    expect((await prisma.agentCommission.findFirstOrThrow({ where: { reservationId: id } })).status).toBe("NETTED");
  });

  it("approve → pay one agent; a paid row reversed becomes a negative row for the next payout", async () => {
    cookieJar.clear();
    await createSession(adminId);
    const ctx = await requireSession();
    const id = await checkedOutStay("AGENT_GROSS");
    await ledger.recordCommissionAtCheckout(id, []);
    const row = await prisma.agentCommission.findFirstOrThrow({ where: { reservationId: id } });
    expect(await ledger.approveCommissions(ctx, propertyId, [row.id])).toBe(1);
    const payout = await ledger.payCommissions(ctx, propertyId, { ids: [row.id], method: "BANK_TRANSFER", reference: "TT-9" });
    expect(payout?.total).toBe(17.48);
    expect((await prisma.agentCommission.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PAID");
    await ledger.reverseCommissionAtCheckout(id);
    const negative = await prisma.agentCommission.findFirstOrThrow({ where: { reservationId: id, amount: { lt: 0 } } });
    expect(negative).toMatchObject({ status: "ACCRUED", amount: -17.48 });
  });
});
