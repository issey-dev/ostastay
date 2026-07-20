// The one shared brain for Allocations (see .agents/docs/ALLOCATIONS_PLAN.md):
// the reservation form's stay-total preview, the reservation routes' attachment
// materialization, and Night Audit's posting loop all call these same functions so
// they can never disagree on rhythm gating, date-range rate selection, or pax math.

export type AllocationRateRange = {
  adultPrice: number
  childPrice: number
  effectiveFrom: Date
  effectiveTo: Date | null
}

export type AllocationLike = {
  id: string
  code: string
  name: string
  mode: string // INCLUDE_IN_RATE | ADD_TO_RATE | SELL_SEPARATE
  postingRhythm: string // EVERY_NIGHT | ARRIVAL_NIGHT | DEPARTURE_NIGHT
  rates: AllocationRateRange[]
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const round2 = (n: number) => Math.round(n * 100) / 100

// The AllocationRate row covering `date`, or null (null = the allocation posts
// nothing that night — deliberately not an error, matching how PriceCalendar simply
// falls back when a date has no row). Ranges are API-validated to never overlap, so
// at most one row can match.
export function rateForDate(rates: AllocationRateRange[], date: Date): AllocationRateRange | null {
  const d = dayStart(date)
  return (
    rates.find((r) => dayStart(r.effectiveFrom) <= d && (!r.effectiveTo || dayStart(r.effectiveTo) >= d)) ?? null
  )
}

// Whether an audited night falls on this allocation's posting rhythm.
// `auditDate` is the night being posted; DEPARTURE_NIGHT means the stay's LAST night
// (checkOutDate minus one day) — no audit runs for a guest on the checkout date itself.
export function isPostingNight(
  postingRhythm: string,
  checkInDate: Date,
  checkOutDate: Date,
  auditDate: Date
): boolean {
  switch (postingRhythm) {
    case "ARRIVAL_NIGHT":
      return sameDay(auditDate, checkInDate)
    case "DEPARTURE_NIGHT": {
      const lastNight = new Date(dayStart(checkOutDate))
      lastNight.setDate(lastNight.getDate() - 1)
      return sameDay(auditDate, lastNight)
    }
    case "EVERY_NIGHT":
    default:
      return true
  }
}

// One night's charge for an allocation: adults × adultPrice + children × childPrice.
// Infants are NEVER charged (owner-confirmed — consistent with the Green Tax infant
// exemption). Returns null when the rhythm doesn't post tonight or no rate range
// covers the date. Overrides (per-reservation negotiated prices) replace the range's
// prices wholesale when set.
export function allocationAmountForNight(params: {
  allocation: AllocationLike
  adults: number
  children: number
  checkInDate: Date
  checkOutDate: Date
  auditDate: Date
  overrideAdultPrice?: number | null
  overrideChildPrice?: number | null
}): number | null {
  const { allocation, adults, children, checkInDate, checkOutDate, auditDate } = params
  if (!isPostingNight(allocation.postingRhythm, checkInDate, checkOutDate, auditDate)) return null

  const range = rateForDate(allocation.rates, auditDate)
  const adultPrice = params.overrideAdultPrice ?? range?.adultPrice
  const childPrice = params.overrideChildPrice ?? range?.childPrice
  if (adultPrice == null && childPrice == null) return null

  return round2(adults * (adultPrice ?? 0) + children * (childPrice ?? 0))
}

// Whole-stay total for one allocation — the reservation form's preview and the
// reservation detail's "Allocations" section. Iterates every night of the stay
// through the same per-night function Night Audit uses.
export function allocationStayTotal(params: {
  allocation: AllocationLike
  adults: number
  children: number
  checkInDate: Date
  checkOutDate: Date
  overrideAdultPrice?: number | null
  overrideChildPrice?: number | null
}): number {
  const { checkInDate, checkOutDate } = params
  let total = 0
  const night = dayStart(checkInDate)
  const end = dayStart(checkOutDate)
  while (night < end) {
    const amount = allocationAmountForNight({ ...params, auditDate: new Date(night) })
    if (amount != null) total += amount
    night.setDate(night.getDate() + 1)
  }
  return round2(total)
}

export type AllocationCalculationMode = "RATE_PLAN" | "MEAL_PLAN"

// The attachment set a reservation should carry — exclusively driven by ONE side,
// per the property's Allocation Calculation setting (Controls > Revenue, see
// Property.allocationCalculationMode): "RATE_PLAN" only reads ratePlanLinks (falling
// back to parentRatePlanLinks for a DERIVED plan with no links of its own — "a
// derived plan is parent + adjustment," single hop, mirroring src/lib/derived-rate.ts
// — and mealPlanLinks is ignored entirely); "MEAL_PLAN" only reads mealPlanLinks and
// ignores the rate plan's links entirely. The two sources are never combined.
export function resolveLinkedAllocationIds(params: {
  mode: AllocationCalculationMode
  ratePlanLinks: Array<{ allocationId: string }>
  parentRatePlanLinks?: Array<{ allocationId: string }> | null
  mealPlanLinks: Array<{ allocationId: string }>
}): Array<{ allocationId: string; source: "RATE_PLAN" | "MEAL_PLAN" }> {
  const out: Array<{ allocationId: string; source: "RATE_PLAN" | "MEAL_PLAN" }> = []
  const seen = new Set<string>()

  if (params.mode === "RATE_PLAN") {
    const effectiveRatePlanLinks =
      params.ratePlanLinks.length > 0 ? params.ratePlanLinks : params.parentRatePlanLinks ?? []
    for (const l of effectiveRatePlanLinks) {
      if (seen.has(l.allocationId)) continue
      seen.add(l.allocationId)
      out.push({ allocationId: l.allocationId, source: "RATE_PLAN" })
    }
  } else {
    for (const l of params.mealPlanLinks) {
      if (seen.has(l.allocationId)) continue
      seen.add(l.allocationId)
      out.push({ allocationId: l.allocationId, source: "MEAL_PLAN" })
    }
  }
  return out
}

export const ALLOCATION_TYPES: string[] = ["FNB", "TRANSFER", "SPA", "EXCURSION", "OTHER"]
export const POSTING_RHYTHMS: string[] = ["EVERY_NIGHT", "ARRIVAL_NIGHT", "DEPARTURE_NIGHT"]
// `mode` governs only rate-plan behavior now; "sell separately" is an independent
// boolean flag on the allocation, not a mode (see Allocation.sellSeparate).
export const ALLOCATION_MODES: string[] = ["INCLUDE_IN_RATE", "ADD_TO_RATE"]

// Parses and validates the `rates` array shared by the allocations POST and PUT
// routes — date-range price rows that must never overlap.
export function parseRatesInput(input: unknown):
  | { ok: true; rates: Array<{ adultPrice: number; childPrice: number; effectiveFrom: Date; effectiveTo: Date | null }> }
  | { ok: false; error: string } {
  if (input == null) return { ok: true, rates: [] }
  if (!Array.isArray(input)) return { ok: false, error: "rates must be an array" }

  const rates = []
  for (const r of input) {
    const adultPrice = parseFloat(r?.adultPrice)
    const childPrice = parseFloat(r?.childPrice)
    const effectiveFrom = r?.effectiveFrom ? new Date(r.effectiveFrom) : null
    const effectiveTo = r?.effectiveTo ? new Date(r.effectiveTo) : null
    if (isNaN(adultPrice) || adultPrice < 0 || isNaN(childPrice) || childPrice < 0) {
      return { ok: false, error: "Each price row needs non-negative adult and child prices" }
    }
    if (!effectiveFrom || isNaN(effectiveFrom.getTime())) {
      return { ok: false, error: "Each price row needs a valid effective-from date" }
    }
    if (effectiveTo && isNaN(effectiveTo.getTime())) {
      return { ok: false, error: "Invalid effective-to date" }
    }
    rates.push({ adultPrice, childPrice, effectiveFrom, effectiveTo })
  }

  const overlapError = validateRateRanges(rates)
  if (overlapError) return { ok: false, error: overlapError }
  return { ok: true, rates }
}

// Overlap validation for AllocationRate ranges (SQLite can't enforce range exclusion).
// Open-ended rows (effectiveTo null) extend to infinity. Returns an error string or
// null when valid — shared by POST and PUT so both validate identically.
export function validateRateRanges(
  ranges: Array<{ effectiveFrom: Date; effectiveTo: Date | null }>
): string | null {
  for (const r of ranges) {
    if (r.effectiveTo && dayStart(r.effectiveTo) < dayStart(r.effectiveFrom)) {
      return "A price range's end date cannot be before its start date"
    }
  }
  const sorted = [...ranges].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]
    const next = sorted[i + 1]
    if (!cur.effectiveTo || dayStart(cur.effectiveTo) >= dayStart(next.effectiveFrom)) {
      return "Price date ranges must not overlap (an open-ended range must be the last one)"
    }
  }
  return null
}
