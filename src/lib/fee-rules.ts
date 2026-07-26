import { prisma } from "@/lib/db";
import { computeReservationQuote } from "@/lib/reservation-quote-server";

// Per-property Deposit / Cancellation / No-Show fee rules (Controls > Fee Rules)
// and the amount computation that drives the Deposit module and the cancellation /
// no-show triggers. Many named rules are allowed per type; a reservation selects one of
// each (Reservation.depositFeeRuleId / cancellationFeeRuleId / noShowFeeRuleId) and the
// fee is computed from that selected rule at event time. See schema.prisma.

export const FEE_RULE_TYPES = ["DEPOSIT", "CANCELLATION", "NO_SHOW"] as const;
export const FEE_BASES = ["FLAT", "PERCENT", "FIRST_NIGHT", "FULL_STAY"] as const;
export type FeeRuleType = (typeof FEE_RULE_TYPES)[number];
export type FeeBasis = (typeof FEE_BASES)[number];

const round2 = (n: number) => Math.round(n * 100) / 100;

export const isFeeRuleType = (v: unknown): v is FeeRuleType =>
  typeof v === "string" && (FEE_RULE_TYPES as readonly string[]).includes(v);
export const isFeeBasis = (v: unknown): v is FeeBasis =>
  typeof v === "string" && (FEE_BASES as readonly string[]).includes(v);

type RuleLike = { basis: string; value: number };
type ReservationLike = {
  propertyId: string;
  adults: number;
  children: number;
  mealPlan: string | null;
  assignments: Array<{ roomTypeId: string; chargeRoomTypeId?: string | null; ratePlanId: string; startDate: Date; endDate: Date; overrideRate: number | null }>;
};

// The fee rule a reservation selected, looked up by id. Returns null when nothing was
// selected (no fee applies) or the rule was since deleted. `expectedType` guards against
// a stale id pointing at the wrong type. The explicit selection is honored even if the
// rule was later marked inactive — inactive only hides it from the picker for NEW
// selections, it doesn't retroactively drop a fee the booking already committed to.
export async function getFeeRuleById(ruleId: string | null | undefined, expectedType?: FeeRuleType) {
  if (!ruleId) return null;
  const rule = await prisma.propertyFeeRule.findUnique({ where: { id: ruleId } });
  if (!rule) return null;
  if (expectedType && rule.ruleType !== expectedType) return null;
  return rule;
}

// Resolve a rule's fee amount for a specific reservation. FLAT needs no quote;
// the other bases project the whole stay via the same engine Night Audit and the
// Proforma use, so a fee is always consistent with the quoted bill.
export async function computeReservationFee(rule: RuleLike, reservation: ReservationLike): Promise<number> {
  if (rule.basis === "FLAT") return round2(Math.max(0, rule.value));
  if (!reservation.assignments.length) return 0;

  const quote = await computeReservationQuote({
    propertyId: reservation.propertyId,
    assignments: reservation.assignments.map((a) => ({
      roomTypeId: a.roomTypeId,
      chargeRoomTypeId: a.chargeRoomTypeId,
      ratePlanId: a.ratePlanId,
      startDate: a.startDate,
      endDate: a.endDate,
      overrideRate: a.overrideRate,
    })),
    adults: reservation.adults,
    children: reservation.children,
    mealPlanCode: reservation.mealPlan,
  });

  switch (rule.basis) {
    case "PERCENT":
      return round2(quote.totals.grandTotal * (Math.max(0, rule.value) / 100));
    case "FULL_STAY":
      return round2(quote.totals.grandTotal);
    case "FIRST_NIGHT": {
      const seg = quote.segments[0];
      if (!seg || seg.nights <= 0) return 0;
      const segTotal = seg.roomBase + seg.roomTax + seg.roomServiceCharge;
      return round2(segTotal / seg.nights);
    }
    default:
      return 0;
  }
}

export function describeFeeRule(rule: { basis: string; value: number }): string {
  switch (rule.basis) {
    case "FLAT": return `$${round2(rule.value).toFixed(2)} flat`;
    case "PERCENT": return `${round2(rule.value)}% of the stay`;
    case "FIRST_NIGHT": return "first night's room charge";
    case "FULL_STAY": return "the full stay";
    default: return "—";
  }
}
