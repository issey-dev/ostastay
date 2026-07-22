import { prisma } from "@/lib/db";
import { computeReservationQuote } from "@/lib/reservation-quote-server";

// Per-property Deposit / Cancellation / No-Show fee rules (Controls > Fee Rules)
// and the amount computation that drives the Deposit module and the cancellation /
// no-show triggers. Rules are stored one row per (property, ruleType) in
// PropertyFeeRule; see schema.prisma.

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
  assignments: Array<{ roomTypeId: string; ratePlanId: string; startDate: Date; endDate: Date; overrideRate: number | null }>;
};

// The active rule of a given type for a property, or null.
export async function getActiveFeeRule(propertyId: string, ruleType: FeeRuleType) {
  const rule = await prisma.propertyFeeRule.findUnique({
    where: { propertyId_ruleType: { propertyId, ruleType } },
  });
  return rule && rule.isActive ? rule : null;
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
