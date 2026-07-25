// Shared Excursions helpers — see .agents/docs/EXCURSIONS_PLAN.md for the full design.
// Mirrors src/lib/allocations.ts's rate-parsing/overlap-validation shape so the two
// dated-pricing systems stay consistent, adapted for the adult/child/infant/flat split.

export const PRICING_MODES = ["PER_PERSON", "FLAT"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

export const DAYS_OF_WEEK = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

// UTC day boundary — dates are stored as UTC midnights (see src/lib/business-date.ts), so
// bucketing/iteration must use UTC too, or a non-UTC server drifts departures by a day (A13).
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export type ExcursionRateInput = {
  adultPrice: number;
  childPrice: number;
  infantPrice: number;
  flatPrice: number | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

// Overlap validation for ExcursionRate ranges (SQLite can't enforce range exclusion) —
// same recipe as allocations.ts's validateRateRanges. Open-ended rows (effectiveTo
// null) extend to infinity. Returns an error string or null when valid, shared by
// POST and PUT so both validate identically.
export function validateRateRanges(ranges: Array<{ effectiveFrom: Date; effectiveTo: Date | null }>): string | null {
  for (const r of ranges) {
    if (r.effectiveTo && dayStart(r.effectiveTo) < dayStart(r.effectiveFrom)) {
      return "A price range's end date cannot be before its start date";
    }
  }
  const sorted = [...ranges].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    if (!cur.effectiveTo || dayStart(cur.effectiveTo) >= dayStart(next.effectiveFrom)) {
      return "Price date ranges must not overlap (an open-ended range must be the last one)";
    }
  }
  return null;
}

export function parseRatesInput(
  input: unknown,
  pricingMode: string
): { ok: true; rates: ExcursionRateInput[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, rates: [] };
  if (!Array.isArray(input)) return { ok: false, error: "rates must be an array" };

  const rates: ExcursionRateInput[] = [];
  for (const r of input) {
    const effectiveFrom = r?.effectiveFrom ? new Date(r.effectiveFrom) : null;
    const effectiveTo = r?.effectiveTo ? new Date(r.effectiveTo) : null;
    if (!effectiveFrom || isNaN(effectiveFrom.getTime())) {
      return { ok: false, error: "Each price row needs a valid effective-from date" };
    }
    if (effectiveTo && isNaN(effectiveTo.getTime())) {
      return { ok: false, error: "Invalid effective-to date" };
    }

    if (pricingMode === "FLAT") {
      const flatPrice = parseFloat(r?.flatPrice);
      if (isNaN(flatPrice) || flatPrice < 0) {
        return { ok: false, error: "Each price row needs a non-negative flat price" };
      }
      rates.push({ adultPrice: 0, childPrice: 0, infantPrice: 0, flatPrice, effectiveFrom, effectiveTo });
    } else {
      const adultPrice = parseFloat(r?.adultPrice);
      const childPrice = parseFloat(r?.childPrice);
      const infantPrice = parseFloat(r?.infantPrice ?? 0);
      if (isNaN(adultPrice) || adultPrice < 0 || isNaN(childPrice) || childPrice < 0 || isNaN(infantPrice) || infantPrice < 0) {
        return { ok: false, error: "Each price row needs non-negative adult, child, and infant prices" };
      }
      rates.push({ adultPrice, childPrice, infantPrice, flatPrice: null, effectiveFrom, effectiveTo });
    }
  }

  const overlapError = validateRateRanges(rates);
  if (overlapError) return { ok: false, error: overlapError };
  return { ok: true, rates };
}

// Finds the ExcursionRate row covering a given date, same "row covering the date wins,
// no row = nothing to charge" convention as allocations.ts's rateForDate.
export function rateForDate<T extends { effectiveFrom: Date | string; effectiveTo: Date | string | null }>(
  rates: T[],
  date: Date
): T | null {
  const d = dayStart(date);
  return (
    rates.find((r) => {
      const from = dayStart(new Date(r.effectiveFrom));
      const to = r.effectiveTo ? dayStart(new Date(r.effectiveTo)) : null;
      return from <= d && (!to || to >= d);
    }) ?? null
  );
}

// Total price for a booking's headcount against a resolved rate row — the same
// computation used at booking time (Phase 2) and mirrored client-side for a live price
// preview. FLAT ignores headcount entirely.
export function computeBookingTotal(
  rate: { adultPrice: number; childPrice: number; infantPrice: number; flatPrice: number | null },
  pricingMode: string,
  counts: { adultCount: number; childCount: number; infantCount: number }
): number {
  if (pricingMode === "FLAT") return rate.flatPrice ?? 0;
  return counts.adultCount * rate.adultPrice + counts.childCount * rate.childPrice + counts.infantCount * rate.infantPrice;
}

function parseDaysOfWeek(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((d) => d.trim().toUpperCase())
      .filter((d) => (DAYS_OF_WEEK as readonly string[]).includes(d))
  );
}

const JS_DAY_TO_CODE: Record<number, string> = { 0: "SUN", 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT" };

// Expands one ExcursionSchedule template into the list of calendar dates (inclusive,
// UTC-day-boundary) it should have a departure on, from `from` through `through`. Does
// NOT touch the database or check for existing departures — see the generate-departures
// route, which diffs this against what already exists so a regenerate never duplicates
// or overwrites an existing (generated or hand-edited) ExcursionDeparture.
export function expandScheduleDates(daysOfWeek: string, from: Date, through: Date): Date[] {
  const wanted = parseDaysOfWeek(daysOfWeek);
  const dates: Date[] = [];
  const cursor = dayStart(from);
  const end = dayStart(through);
  while (cursor <= end) {
    if (wanted.has(JS_DAY_TO_CODE[cursor.getUTCDay()])) {
      dates.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// Combines ExcursionDeparture's separate date + "HH:MM" time-of-day fields into one
// real Date, for cutoff-window and past-departure comparisons (cancellation, no-show).
export function combineDepartureDateTime(departureDate: Date, departureTime: string): Date {
  const [hours, minutes] = departureTime.split(":").map(Number);
  const dt = new Date(departureDate);
  dt.setHours(hours || 0, minutes || 0, 0, 0);
  return dt;
}
