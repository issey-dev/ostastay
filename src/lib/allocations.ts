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

// Date-only comparisons are UTC-based, matching how the app stores every domain
// date: reservation check-in/out dates (forms submit plain YYYY-MM-DD → UTC
// midnight) and the property business date (src/lib/business-date.ts) are all UTC
// midnights. Comparing with local calendar parts here would drift by a day
// whenever the host timezone's local day differs from the UTC day.
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const sameDay = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
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
      const lastNight = new Date(dayStart(checkOutDate).getTime() - 86_400_000)
      return sameDay(auditDate, lastNight)
    }
    case "EVERY_NIGHT":
    default:
      return true
  }
}

// --- Split stays: which nights a rate-plan allocation covers -------------------------
//
// A rate plan's linked allocations (e.g. a breakfast package) belong to the NIGHTS that
// plan prices. On a split stay each segment can carry a different rate plan, so a
// RATE_PLAN-sourced allocation is stored with the windows it covers and only posts on
// those nights; its rhythm (arrival / departure night) is anchored to those windows
// rather than the whole stay. No windows (null) = the whole stay, which is every
// single-segment booking, every meal-plan and every manual allocation.

/** A run of nights [from, to): `to` is the departure morning, as with a stay's check-out. */
export type DateWindow = { from: Date; to: Date }

const keyOf = (d: Date) => dayStart(d).toISOString().slice(0, 10)

export function serializeWindows(windows: DateWindow[]): string {
  return windows.map((w) => `${keyOf(w.from)}/${keyOf(w.to)}`).join(",")
}

export function parseWindows(raw: string | null | undefined): DateWindow[] | null {
  if (!raw) return null
  const out: DateWindow[] = []
  for (const part of raw.split(",")) {
    const [a, b] = part.split("/")
    const from = new Date(`${a}T00:00:00.000Z`)
    const to = new Date(`${b}T00:00:00.000Z`)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) continue
    out.push({ from, to })
  }
  return out.length > 0 ? out : null
}

export function nightInWindows(night: Date, windows: DateWindow[] | null | undefined): boolean {
  if (!windows) return true
  const d = dayStart(night)
  return windows.some((w) => dayStart(w.from) <= d && d < dayStart(w.to))
}

/** The first arrival and last departure across the windows — the anchors for the rhythm. */
export function windowAnchors(windows: DateWindow[]): { checkInDate: Date; checkOutDate: Date } {
  return {
    checkInDate: new Date(Math.min(...windows.map((w) => dayStart(w.from).getTime()))),
    checkOutDate: new Date(Math.max(...windows.map((w) => dayStart(w.to).getTime()))),
  }
}

/**
 * For each allocation any segment's rate plan links, the windows (back-to-back segments
 * merged) it covers. `null` windows = it covers the whole stay.
 */
export function ratePlanAllocationWindows(
  segments: Array<{ startDate: Date; endDate: Date; linkedAllocationIds: string[] }>
): Map<string, DateWindow[] | null> {
  const ordered = [...segments].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
  const stayFrom = ordered.length ? dayStart(ordered[0].startDate).getTime() : 0
  const stayTo = ordered.length ? Math.max(...ordered.map((s) => dayStart(s.endDate).getTime())) : 0
  const ids = new Set(ordered.flatMap((s) => s.linkedAllocationIds))
  const out = new Map<string, DateWindow[] | null>()
  for (const id of ids) {
    const windows: DateWindow[] = []
    for (const seg of ordered) {
      if (!seg.linkedAllocationIds.includes(id)) continue
      const from = dayStart(seg.startDate)
      const to = dayStart(seg.endDate)
      const last = windows[windows.length - 1]
      if (last && last.to.getTime() === from.getTime()) last.to = to
      else windows.push({ from, to })
    }
    const whole = windows.length === 1 && windows[0].from.getTime() === stayFrom && windows[0].to.getTime() === stayTo
    out.set(id, whole ? null : windows)
  }
  return out
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
  /** Split stay: only these nights carry the allocation (see DateWindow). */
  windows?: DateWindow[] | null
}): number | null {
  const { allocation, adults, children, auditDate, windows } = params
  if (!nightInWindows(auditDate, windows)) return null
  const { checkInDate, checkOutDate } = windows ? windowAnchors(windows) : params
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
  windows?: DateWindow[] | null
}): number {
  const { checkInDate, checkOutDate } = params
  let total = 0
  const night = dayStart(checkInDate)
  const end = dayStart(checkOutDate)
  while (night < end) {
    const amount = allocationAmountForNight({ ...params, auditDate: new Date(night) })
    if (amount != null) total += amount
    night.setTime(night.getTime() + 86_400_000) // step one UTC day
  }
  return round2(total)
}

// A run of consecutive nights sharing the same per-adult/per-child unit price (prices
// can change mid-stay via AllocationRate date ranges, or per-reservation overrides —
// which never change mid-stay, so an override always yields exactly one segment).
export type AllocationStaySegment = {
  nights: number
  adultPrice: number
  childPrice: number
  amountPerNight: number
  subtotal: number
}

export type AllocationStayBreakdown = {
  postingRhythm: string
  totalNights: number
  postingNights: number
  // Rhythm-qualifying nights with no AllocationRate covering them and no override —
  // silently unbilled, same as allocationAmountForNight's null case.
  unpricedNights: number
  segments: AllocationStaySegment[]
  total: number
}

// Explains a stay total night-by-night instead of collapsing straight to one number —
// the booking summary's "how was this calculated" line. Walks the exact same
// rhythm/rate resolution as allocationAmountForNight/allocationStayTotal so the
// explanation can never drift from the total those functions report.
export function allocationStayBreakdown(params: {
  allocation: AllocationLike
  adults: number
  children: number
  checkInDate: Date
  checkOutDate: Date
  overrideAdultPrice?: number | null
  overrideChildPrice?: number | null
  windows?: DateWindow[] | null
}): AllocationStayBreakdown {
  const { allocation, adults, children, windows } = params
  const { checkInDate: anchorIn, checkOutDate: anchorOut } = windows ? windowAnchors(windows) : params
  const { checkInDate, checkOutDate } = params
  const night = dayStart(checkInDate)
  const end = dayStart(checkOutDate)
  const totalNights = Math.max(0, Math.round((end.getTime() - night.getTime()) / 86_400_000))

  let postingNights = 0
  let unpricedNights = 0
  const segments: AllocationStaySegment[] = []
  let current: { adultPrice: number; childPrice: number; amountPerNight: number; nights: number } | null = null

  const flush = () => {
    if (!current) return
    segments.push({ ...current, subtotal: round2(current.amountPerNight * current.nights) })
    current = null
  }

  while (night < end) {
    if (nightInWindows(night, windows) && isPostingNight(allocation.postingRhythm, anchorIn, anchorOut, night)) {
      const range = rateForDate(allocation.rates, night)
      const adultPrice = params.overrideAdultPrice ?? range?.adultPrice
      const childPrice = params.overrideChildPrice ?? range?.childPrice
      if (adultPrice == null && childPrice == null) {
        unpricedNights++
        flush()
      } else {
        postingNights++
        const ap = adultPrice ?? 0
        const cp = childPrice ?? 0
        const amountPerNight = round2(adults * ap + children * cp)
        if (current && current.adultPrice === ap && current.childPrice === cp) {
          current.nights++
        } else {
          flush()
          current = { adultPrice: ap, childPrice: cp, amountPerNight, nights: 1 }
        }
      }
    } else {
      flush()
    }
    night.setTime(night.getTime() + 86_400_000) // step one UTC day
  }
  flush()

  return {
    postingRhythm: allocation.postingRhythm,
    totalNights,
    postingNights,
    unpricedNights,
    segments,
    total: round2(segments.reduce((sum, s) => sum + s.subtotal, 0)),
  }
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
