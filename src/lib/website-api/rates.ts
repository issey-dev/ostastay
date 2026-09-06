import { prisma } from "@/lib/db";
import { applyRateAdjustment } from "@/lib/derived-rate";
import { formatLocalDay } from "@/lib/availability";

// Per-night DISPLAY prices for the website's availability calendar — one rate plan (the
// one the Hub configured the site to sell), every sellable room type, every night.
//
// Resolution mirrors the channel push (src/lib/channels/rates.ts) hop for hop:
//   1. the plan's own PriceCalendar entry for (plan, room type, date)
//   2. for a DERIVED plan, the parent's entry with the plan's adjustment applied
//   3. the property's LOCKED base plan's entry — the documented last resort
// Extra-occupancy surcharges come from the plan's own (or parent's) row only, never the
// base fallback — the same rule computeReservationQuote applies.
//
// ⚠️ A night with no resolvable price is reported as null, never 0. Zero is a real price
// that would put rooms on sale for nothing; the booking path refuses a stay with any
// unpriced night rather than confirm it at a figure the desk would never honour.
//
// These are the numbers a website SHOWS. What it CHARGES comes from the quote endpoint,
// which runs computeReservationQuote — taxes, service charge, Green Tax and package
// allocations included. The calendar price is the room rate only.

const DAY_MS = 86_400_000;

export type NightlyPrice = {
  /** Room rate for the night, before tax handling. Null when no price is configured. */
  price: number | null;
  extraAdultPrice: number | null;
  extraChildPrice: number | null;
};

/** roomTypeId -> (YYYY-MM-DD -> price). Every requested night is present. */
export type NightlyPriceGrid = Map<string, Map<string, NightlyPrice>>;

export async function resolveWebsiteNightlyPrices(opts: {
  propertyId: string;
  ratePlanId: string;
  roomTypeIds: string[];
  from: Date;
  to: Date;
}): Promise<NightlyPriceGrid> {
  const { propertyId, ratePlanId, roomTypeIds, from, to } = opts;
  const grid: NightlyPriceGrid = new Map();
  if (roomTypeIds.length === 0) return grid;

  const plan = await prisma.ratePlan.findFirst({
    where: { id: ratePlanId, propertyId },
    select: { id: true, parentRatePlanId: true, derivedAdjustmentType: true, derivedAdjustmentValue: true },
  });
  if (!plan) return grid;

  const basePlan = await prisma.ratePlan.findFirst({ where: { propertyId, isLocked: true }, select: { id: true } });

  const lookupPlanIds = new Set<string>([plan.id]);
  if (plan.parentRatePlanId) lookupPlanIds.add(plan.parentRatePlanId);
  if (basePlan) lookupPlanIds.add(basePlan.id);

  const rows = await prisma.priceCalendar.findMany({
    where: {
      ratePlanId: { in: [...lookupPlanIds] },
      roomTypeId: { in: roomTypeIds },
      date: { gte: from, lt: to },
    },
    select: { ratePlanId: true, roomTypeId: true, date: true, price: true, extraAdultPrice: true, extraChildPrice: true },
  });

  const key = (planId: string, roomTypeId: string, date: string) => `${planId}|${roomTypeId}|${date}`;
  const calendar = new Map<string, { price: number; extraAdultPrice: number | null; extraChildPrice: number | null }>();
  for (const r of rows) {
    calendar.set(key(r.ratePlanId, r.roomTypeId, formatLocalDay(r.date.getTime())), {
      price: r.price,
      extraAdultPrice: r.extraAdultPrice,
      extraChildPrice: r.extraChildPrice,
    });
  }

  const dates: string[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY_MS) dates.push(formatLocalDay(t));

  const isDerived = !!plan.parentRatePlanId && !!plan.derivedAdjustmentType && plan.derivedAdjustmentValue != null;

  for (const roomTypeId of roomTypeIds) {
    const perDate = new Map<string, NightlyPrice>();
    for (const date of dates) {
      // 1. the plan's own row — also the only source of extra-occupancy surcharges.
      const own = calendar.get(key(plan.id, roomTypeId, date));
      // 2. a derived plan takes its parent's row and adjusts the price; the parent's
      //    surcharges apply as-is (the adjustment is on the room rate, not the extras).
      const parent = isDerived ? calendar.get(key(plan.parentRatePlanId!, roomTypeId, date)) : undefined;

      let price: number | null = own?.price ?? null;
      if (price == null && parent) {
        price = applyRateAdjustment(parent.price, plan.derivedAdjustmentType!, plan.derivedAdjustmentValue!);
      }
      // 3. the locked base plan, the documented last resort
      if (price == null && basePlan && basePlan.id !== plan.id) {
        price = calendar.get(key(basePlan.id, roomTypeId, date))?.price ?? null;
      }

      const surchargeSource = own ?? parent;
      perDate.set(date, {
        price,
        extraAdultPrice: surchargeSource?.extraAdultPrice ?? null,
        extraChildPrice: surchargeSource?.extraChildPrice ?? null,
      });
    }
    grid.set(roomTypeId, perDate);
  }

  return grid;
}
