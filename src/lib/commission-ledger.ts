import { prisma } from "@/lib/db";
import { resolveBusinessDate } from "@/lib/business-date";
import { requireCapability, type AuthContext } from "@/lib/scope";
import { isSettlementMode, type SettlementMode } from "@/lib/booking-markers";
import { logActivity } from "@/lib/activity-log";

// The commission ledger (Agent Portal plan A-18…A-20, §8; Phase 7, 9.7.0).
//
// Rules (owner, 2026-11-11):
//   · The base is the rate as defined: the room-charge lines' amount (stored without service
//     charge and tax), extra occupancy included, whatever the rate itself includes (meals in
//     the rate). Never Green Tax, service charge, taxes, transfers, extras, anything the guest
//     spends, cancellation or no-show fees. Complimentary and house-use plans earn nothing.
//   · Rate: the rate plan link's commissionRate for the party, else the party's own
//     Profile.commissionRate.
//   · Rounded half-up to two decimals ONCE per reservation and plan, not per night.
//   · The party is the booking's Source, else its Travel Agent.
//   · Mode AGENT_NET with a City Ledger invoice: check-out already posts the negative line on
//     the invoice (src/lib/reservations/check-out.ts) → a NETTED row. Otherwise → ACCRUED,
//     payable to the agent, and nothing is posted to the guest's folio.

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Line = { amount: number; isVoid: boolean; roomAssignmentId: string | null };
type Assignment = { id: string; ratePlanId: string };
type Plan = { id: string; isComplimentary: boolean; isHouseUse: boolean; linkRate: number | null };

/** Pure: base and commission per rate plan. */
export function commissionByPlan(lines: Line[], assignments: Assignment[], plans: Plan[], fallbackRate: number | null) {
  const planOf = new Map(assignments.map((a) => [a.id, a.ratePlanId]));
  const base = new Map<string, number>();
  for (const l of lines) {
    if (l.isVoid || !l.roomAssignmentId) continue;
    const p = planOf.get(l.roomAssignmentId);
    if (!p) continue;
    base.set(p, (base.get(p) ?? 0) + l.amount);
  }
  const out: { ratePlanId: string; baseAmount: number; rate: number; amount: number }[] = [];
  for (const [ratePlanId, b] of base) {
    const plan = plans.find((x) => x.id === ratePlanId);
    if (!plan || plan.isComplimentary || plan.isHouseUse) continue;
    const rate = plan.linkRate ?? fallbackRate ?? 0;
    if (!(rate > 0) || !(b > 0)) continue;
    out.push({ ratePlanId, baseAmount: round2(b), rate, amount: round2((b * rate) / 100) });
  }
  return out;
}

/** Write the ledger for a reservation that has just been checked out. Idempotent. */
export async function recordCommissionAtCheckout(reservationId: string, netted: { folioId: string; amount: number }[]) {
  const r = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: {
      property: { select: { businessDate: true } },
      assignments: { select: { id: true, ratePlanId: true } },
      folios: { select: { id: true, lineItems: { select: { amount: true, isVoid: true, roomAssignmentId: true } } } },
      sourceProfile: { select: { upid: true, commissionRate: true, settlementMode: true } },
      travelAgent: { select: { upid: true, commissionRate: true } },
    },
  });
  if (!r || r.isPostingMaster) return [];
  const party = r.sourceProfile ?? r.travelAgent;
  if (!party) return [];
  const existing = await prisma.agentCommission.count({ where: { reservationId, status: { not: "REVERSED" } } });
  if (existing > 0) return [];

  const modeRaw = r.settlementMode ?? r.sourceProfile?.settlementMode ?? "AGENT_NET";
  const mode: SettlementMode = isSettlementMode(modeRaw) ? modeRaw : "AGENT_NET";
  const planIds = [...new Set(r.assignments.map((a) => a.ratePlanId))];
  const [plans, links] = await Promise.all([
    prisma.ratePlan.findMany({ where: { id: { in: planIds } }, select: { id: true, isComplimentary: true, isHouseUse: true } }),
    prisma.ratePlanAgentAccess.findMany({ where: { ratePlanId: { in: planIds }, upid: party.upid }, select: { ratePlanId: true, commissionRate: true } }),
  ]);
  const lines = r.folios.flatMap((f) => f.lineItems);
  const rows = commissionByPlan(
    lines,
    r.assignments,
    plans.map((p) => ({ ...p, linkRate: links.find((l) => l.ratePlanId === p.id)?.commissionRate ?? null })),
    party.commissionRate
  );
  if (rows.length === 0) return [];
  const businessDate = resolveBusinessDate(r.property);
  const nettedTotal = round2(netted.reduce((s, n) => s + n.amount, 0));
  const status = mode === "AGENT_NET" && nettedTotal > 0 ? "NETTED" : "ACCRUED";
  await prisma.agentCommission.createMany({
    data: rows.map((x) => ({
      propertyId: r.propertyId,
      profileId: party.upid,
      reservationId,
      folioId: netted[0]?.folioId ?? null,
      ratePlanId: x.ratePlanId,
      baseAmount: x.baseAmount,
      rate: x.rate,
      amount: x.amount,
      mode,
      status,
      businessDate,
    })),
  });
  return rows;
}

/** A reversed check-out reverses the commission; one already paid becomes a negative row. */
export async function reverseCommissionAtCheckout(reservationId: string) {
  const rows = await prisma.agentCommission.findMany({ where: { reservationId, status: { not: "REVERSED" }, amount: { gt: 0 } } });
  for (const c of rows) {
    if (c.status === "PAID") {
      await prisma.agentCommission.create({
        data: {
          propertyId: c.propertyId,
          profileId: c.profileId,
          reservationId,
          folioId: c.folioId,
          ratePlanId: c.ratePlanId,
          baseAmount: -c.baseAmount,
          rate: c.rate,
          amount: -c.amount,
          mode: c.mode,
          status: "ACCRUED",
          businessDate: c.businessDate,
          note: "Reversal of a paid commission (check-out reversed)",
        },
      });
    } else {
      await prisma.agentCommission.update({ where: { id: c.id }, data: { status: "REVERSED" } });
    }
  }
}

// ── Debtors › Commissions ──────────────────────────────────────────────────────────

export async function listCommissions(propertyId: string, q: { status?: string | null; profileId?: string | null }) {
  const rows = await prisma.agentCommission.findMany({
    where: { propertyId, ...(q.status ? { status: q.status } : {}), ...(q.profileId ? { profileId: q.profileId } : {}) },
    orderBy: { businessDate: "desc" },
    take: 500,
  });
  const [profiles, reservations] = await Promise.all([
    prisma.profile.findMany({ where: { upid: { in: [...new Set(rows.map((r) => r.profileId))] } }, select: { upid: true, companyName: true, firstName: true } }),
    prisma.reservation.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.reservationId))] } }, select: { id: true, confirmationNo: true, agentRef: true, checkInDate: true, checkOutDate: true } }),
  ]);
  return rows.map((r) => ({
    ...r,
    profileName: profiles.find((p) => p.upid === r.profileId)?.companyName ?? profiles.find((p) => p.upid === r.profileId)?.firstName ?? "",
    reservation: reservations.find((x) => x.id === r.reservationId) ?? null,
  }));
}

export async function approveCommissions(ctx: AuthContext, propertyId: string, ids: string[]) {
  requireCapability(ctx, "debtors.payCommission");
  const c = await prisma.agentCommission.updateMany({ where: { id: { in: ids }, propertyId, status: "ACCRUED" }, data: { status: "APPROVED" } });
  await logActivity({ ctx, module: "DEBTORS", action: "UPDATE", entityType: "AgentCommission", entityId: propertyId, description: `Approved ${c.count} commission row(s)` });
  return c.count;
}

/** Pay out (or offset) approved commission for ONE agent. */
export async function payCommissions(
  ctx: AuthContext,
  propertyId: string,
  input: { ids: string[]; method: string; reference?: string | null }
) {
  requireCapability(ctx, "debtors.payCommission");
  const methods = ["BANK_TRANSFER", "CASH", "CHEQUE", "OFFSET"];
  if (!methods.includes(input.method)) throw new Error("METHOD");
  const rows = await prisma.agentCommission.findMany({ where: { id: { in: input.ids }, propertyId, status: { in: ["APPROVED", "ACCRUED"] } } });
  if (rows.length === 0) return null;
  const profiles = [...new Set(rows.map((r) => r.profileId))];
  if (profiles.length > 1) throw new Error("ONE_AGENT");
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const payout = await prisma.$transaction(async (tx) => {
    const p = await tx.agentCommissionPayout.create({
      data: { propertyId, profileId: profiles[0], total, method: input.method, reference: input.reference?.trim() || null, paidAt: new Date(), createdByUserId: ctx.userId },
    });
    await tx.agentCommission.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: "PAID", payoutId: p.id } });
    return p;
  });
  await logActivity({
    ctx,
    module: "DEBTORS",
    action: "UPDATE",
    entityType: "AgentCommissionPayout",
    entityId: payout.id,
    description: `Commission ${input.method === "OFFSET" ? "offset" : "paid"}: ${total.toFixed(2)} (${rows.length} row(s))`,
  });
  return payout;
}

/** The agent's statement for one property: invoices, payments, commissions, balance. */
export async function agentStatement(profileId: string, propertyId: string, from: Date, to: Date) {
  const invoices = await prisma.folio.findMany({
    where: { propertyId, payeeProfileId: profileId, isDebtorAccount: true, OR: [{ closedBusinessDate: { gte: from, lt: to } }, { closedBusinessDate: null }] },
    select: {
      id: true, folioNumber: true, closedBusinessDate: true,
      reservation: { select: { confirmationNo: true, agentRef: true } },
      lineItems: { where: { isVoid: false }, select: { amount: true, taxAmount: true, serviceChargeAmount: true } },
      payments: { select: { amount: true, isRefund: true, createdAt: true } },
    },
  });
  const commissions = await prisma.agentCommission.findMany({
    where: { propertyId, profileId, businessDate: { gte: from, lt: to }, status: { not: "REVERSED" } },
    orderBy: { businessDate: "asc" },
  });
  const inv = invoices.map((f) => {
    const charged = round2(f.lineItems.reduce((s, l) => s + l.amount + l.taxAmount + l.serviceChargeAmount, 0));
    const paid = round2(f.payments.reduce((s, p) => s + (p.isRefund ? -p.amount : p.amount), 0));
    return { id: f.id, date: f.closedBusinessDate ? f.closedBusinessDate.toISOString().slice(0, 10) : null, booking: f.reservation?.agentRef ?? f.reservation?.confirmationNo ?? null, charged, paid, open: round2(charged - paid) };
  });
  const owedToAgent = round2(commissions.filter((c) => c.status === "ACCRUED" || c.status === "APPROVED").reduce((s, c) => s + c.amount, 0));
  const owedByAgent = round2(inv.reduce((s, i) => s + i.open, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    invoices: inv,
    commissions: commissions.map((c) => ({ date: c.businessDate.toISOString().slice(0, 10), base: c.baseAmount, rate: c.rate, amount: c.amount, mode: c.mode, status: c.status })),
    totals: { owedByAgent, owedToAgent, net: round2(owedByAgent - owedToAgent) },
  };
}
