// Travel Agent commission at checkout (see .agents/docs/DECISIONS.md "Negotiated Rate
// Plans" and RatePlanAgentAccess.commissionRate). Pure math, no Prisma — unit-testable
// in isolation and reused by the checkout route.
//
// Room revenue is attributed back to the rate plan that earned it via
// FolioLineItem.roomAssignmentId (set by Night Audit on the Nightly Room Charge and
// Extra Occupancy Charge lines only) -> RoomAssignment.ratePlanId. A split-stay
// reservation spanning more than one rate plan is handled correctly: each rate plan's
// own room revenue is matched against its own linked commission rate, if any.

export type CommissionLineItem = { amount: number; isVoid: boolean; roomAssignmentId: string | null };
export type CommissionAssignment = { id: string; ratePlanId: string };
export type CommissionRateLink = { ratePlanId: string; commissionRate: number | null };

export type CommissionBreakdownEntry = {
  ratePlanId: string;
  roomRevenue: number;
  commissionRate: number;
  commission: number;
};

export function calculateFolioCommission(
  lineItems: CommissionLineItem[],
  assignments: CommissionAssignment[],
  rateLinks: CommissionRateLink[]
): { amount: number; breakdown: CommissionBreakdownEntry[] } {
  const revenueByAssignment = new Map<string, number>();
  for (const item of lineItems) {
    if (item.isVoid || !item.roomAssignmentId) continue;
    revenueByAssignment.set(item.roomAssignmentId, (revenueByAssignment.get(item.roomAssignmentId) ?? 0) + item.amount);
  }

  const revenueByRatePlan = new Map<string, number>();
  for (const assignment of assignments) {
    const revenue = revenueByAssignment.get(assignment.id);
    if (!revenue) continue;
    revenueByRatePlan.set(assignment.ratePlanId, (revenueByRatePlan.get(assignment.ratePlanId) ?? 0) + revenue);
  }

  const breakdown: CommissionBreakdownEntry[] = [];
  let amount = 0;
  for (const [ratePlanId, roomRevenue] of revenueByRatePlan) {
    const link = rateLinks.find((l) => l.ratePlanId === ratePlanId);
    if (!link || link.commissionRate == null || link.commissionRate <= 0) continue;
    const commission = roomRevenue * (link.commissionRate / 100);
    breakdown.push({ ratePlanId, roomRevenue, commissionRate: link.commissionRate, commission });
    amount += commission;
  }

  return { amount, breakdown };
}
