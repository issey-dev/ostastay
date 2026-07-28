import { prisma } from "@/lib/db";
import { applyRateAdjustment } from "@/lib/derived-rate";
import { formatLocalDay } from "@/lib/availability";

// Per-night prices for the channel push.
//
// Resolution deliberately mirrors what the app itself charges
// (src/lib/reservation-quote-server.ts), one hop at a time:
//   1. the rate plan's own PriceCalendar entry for (plan, room type, date)
//   2. failing that, the property's LOCKED base rate plan's entry — the documented
//      fallback on PriceCalendar.price
//   3. for a DERIVED plan, the parent's resolved price with the plan's adjustment applied
//      (PERCENT or FLAT), since a derived plan stores no rows of its own
//
// Publishing a price that disagrees with what the PMS would charge is worse than
// publishing none: the guest is quoted one figure by the OTA and billed another at the
// desk. So this reuses applyRateAdjustment() rather than re-deriving the arithmetic.

const DAY_MS = 86_400_000;

/** Per-night price for one rate plan: date -> amount. A date is ABSENT when unpriced. */
export type RatePlanNightlyPrices = {
  ratePlanId: string;
  externalRateId: string;
  /** Keyed by YYYY-MM-DD. A missing key means NO PRICE — never treat it as zero. */
  prices: Record<string, number>;
};

/**
 * Resolve nightly prices for every MAPPED rate plan of a link, per room type.
 *
 * Returns a map keyed by room type id. Only rate plans carrying an externalRateId appear —
 * an unmapped plan has nowhere to go at the channel.
 *
 * ⚠️ A night with no resolvable price is OMITTED, never emitted as 0. Zero is a real price
 * that would put rooms on sale for nothing; "we don't know" and "it's free" must never
 * collapse into the same value. Callers push only the dates present here.
 */
export async function resolveRatesForLink(opts: {
  propertyId: string;
  linkId: string;
  roomTypeIds: string[];
  from: Date;
  to: Date;
}): Promise<Map<string, RatePlanNightlyPrices[]>> {
  const { propertyId, linkId, roomTypeIds, from, to } = opts;
  const result = new Map<string, RatePlanNightlyPrices[]>();
  if (roomTypeIds.length === 0) return result;

  const maps = await prisma.channelRatePlanMap.findMany({
    where: { linkId },
    select: { ratePlanId: true, externalRateId: true },
  });
  if (maps.length === 0) return result;

  const mappedPlanIds = maps.map((m) => m.ratePlanId);
  const plans = await prisma.ratePlan.findMany({
    where: { id: { in: mappedPlanIds }, propertyId },
    select: {
      id: true,
      parentRatePlanId: true,
      derivedAdjustmentType: true,
      derivedAdjustmentValue: true,
    },
  });
  const planById = new Map(plans.map((p) => [p.id, p]));

  const baseRatePlan = await prisma.ratePlan.findFirst({
    where: { propertyId, isLocked: true },
    select: { id: true },
  });

  // Fetch every plan whose rows we might need in one query: the mapped plans, their
  // parents (derived plans store no rows of their own), and the locked base plan.
  const lookupPlanIds = new Set<string>(mappedPlanIds);
  for (const p of plans) if (p.parentRatePlanId) lookupPlanIds.add(p.parentRatePlanId);
  if (baseRatePlan) lookupPlanIds.add(baseRatePlan.id);

  const rows = await prisma.priceCalendar.findMany({
    where: {
      ratePlanId: { in: [...lookupPlanIds] },
      roomTypeId: { in: roomTypeIds },
      date: { gte: from, lt: to },
    },
    select: { ratePlanId: true, roomTypeId: true, date: true, price: true },
  });

  const key = (planId: string, roomTypeId: string, date: string) => `${planId}|${roomTypeId}|${date}`;
  const calendar = new Map<string, number>();
  for (const r of rows) {
    calendar.set(key(r.ratePlanId, r.roomTypeId, formatLocalDay(r.date.getTime())), r.price);
  }

  const dates: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) dates.push(formatLocalDay(t));

  for (const roomTypeId of roomTypeIds) {
    const perPlan: RatePlanNightlyPrices[] = [];

    for (const m of maps) {
      const plan = planById.get(m.ratePlanId);
      if (!plan) continue; // mapped plan belongs to another property — ignore rather than trust

      const prices: Record<string, number> = {};
      for (const date of dates) {
        // 1. the plan's own row
        let price = calendar.get(key(plan.id, roomTypeId, date));

        // 2. a derived plan takes its parent's price and adjusts it
        if (
          price == null &&
          plan.parentRatePlanId &&
          plan.derivedAdjustmentType &&
          plan.derivedAdjustmentValue != null
        ) {
          const parentPrice = calendar.get(key(plan.parentRatePlanId, roomTypeId, date));
          if (parentPrice != null) {
            price = applyRateAdjustment(parentPrice, plan.derivedAdjustmentType, plan.derivedAdjustmentValue);
          }
        }

        // 3. the property's locked base plan, the documented last resort
        if (price == null && baseRatePlan && baseRatePlan.id !== plan.id) {
          price = calendar.get(key(baseRatePlan.id, roomTypeId, date));
        }

        // Still nothing: leave the date out. Never 0 — see the note above.
        if (price != null) prices[date] = price;
      }

      perPlan.push({ ratePlanId: plan.id, externalRateId: m.externalRateId, prices });
    }

    if (perPlan.length > 0) result.set(roomTypeId, perPlan);
  }

  return result;
}
