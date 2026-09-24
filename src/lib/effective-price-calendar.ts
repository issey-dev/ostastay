import { prisma } from "@/lib/db"
import { applyRateAdjustment } from "@/lib/derived-rate"

// What the Price Calendar grid shows for a rate plan × room type — the price Night
// Audit would actually post each night, resolved the same way
// src/lib/night-audit/stay-night.ts does:
//
//   1. the plan's own PriceCalendar entry — or, for a Derived plan, its PARENT's entry
//      (derived plans have no rows of their own);
//   2. otherwise the property's locked Base Rate plan's entry for that night;
//   3. a Derived plan's adjustment is then applied to whichever price was found.
//
// Occupancy surcharges come only from step 1's entry (Night Audit reads them from that
// entry alone), so a Base-fallback night shows none. A night with no price anywhere is
// left out — Night Audit flags it as a zero-rate night rather than pricing it.

export type EffectivePriceSource = "OWN" | "BASE_FALLBACK"

export type EffectivePriceEntry = {
  date: string
  price: number
  extraAdultPrice: number | null
  extraChildPrice: number | null
  /** Where the underlying price came from: the plan's (or its parent's) own calendar, or the Base Rate plan. */
  source: EffectivePriceSource
  /** True when a Derived plan's adjustment was applied on top. */
  derived: boolean
}

type PlanForResolution = {
  id: string
  propertyId: string
  parentRatePlanId: string | null
  derivedAdjustmentType: string | null
  derivedAdjustmentValue: number | null
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

export async function resolveEffectivePrices(
  ratePlan: PlanForResolution,
  roomTypeId: string,
  startDate: Date,
  endDate: Date
): Promise<EffectivePriceEntry[]> {
  const isDerived = !!ratePlan.parentRatePlanId
  const calendarRatePlanId = isDerived ? ratePlan.parentRatePlanId! : ratePlan.id
  const base = await prisma.ratePlan.findFirst({
    where: { propertyId: ratePlan.propertyId, isLocked: true },
    select: { id: true },
  })
  const range = { gte: startDate, lte: endDate }

  const [own, baseRows] = await Promise.all([
    prisma.priceCalendar.findMany({ where: { ratePlanId: calendarRatePlanId, roomTypeId, date: range } }),
    base && base.id !== calendarRatePlanId
      ? prisma.priceCalendar.findMany({ where: { ratePlanId: base.id, roomTypeId, date: range } })
      : Promise.resolve([]),
  ])
  const ownByDay = new Map(own.map((r) => [dayKey(r.date), r]))
  const baseByDay = new Map(baseRows.map((r) => [dayKey(r.date), r]))

  const adjust = (price: number) =>
    isDerived && ratePlan.derivedAdjustmentType && ratePlan.derivedAdjustmentValue != null
      ? applyRateAdjustment(price, ratePlan.derivedAdjustmentType, ratePlan.derivedAdjustmentValue)
      : price

  const days = [...new Set([...ownByDay.keys(), ...baseByDay.keys()])].sort()
  const out: EffectivePriceEntry[] = []
  for (const day of days) {
    const entry = ownByDay.get(day)
    if (entry) {
      out.push({
        date: entry.date.toISOString(),
        price: adjust(entry.price),
        extraAdultPrice: entry.extraAdultPrice,
        extraChildPrice: entry.extraChildPrice,
        source: "OWN",
        derived: isDerived,
      })
      continue
    }
    const fallback = baseByDay.get(day)!
    out.push({
      date: fallback.date.toISOString(),
      price: adjust(fallback.price),
      extraAdultPrice: null,
      extraChildPrice: null,
      source: "BASE_FALLBACK",
      derived: isDerived,
    })
  }
  return out
}
