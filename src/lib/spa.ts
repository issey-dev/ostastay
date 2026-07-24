// Shared Spa Booking helpers — see .agents/docs/SPA_PLAN.md for the full design.
// Mirrors src/lib/excursions.ts's rate-parsing/overlap-validation shape (itself mirrored
// from allocations.ts) so all three dated-pricing systems stay consistent. Spa's own
// rate row is simpler than Excursions' (one `price`, not adult/child/infant/flat) since
// pricingMode alone decides whether it's multiplied by party size or charged flat.

export const PRICING_MODES = ["PER_PERSON", "FLAT"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export type SpaRateInput = {
  price: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

// Overlap validation for SpaTreatmentRate ranges (SQLite can't enforce range
// exclusion) — same recipe as excursions.ts's validateRateRanges. Open-ended rows
// (effectiveTo null) extend to infinity. Returns an error string or null when valid,
// shared by POST and PUT so both validate identically.
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

export function parseRatesInput(input: unknown): { ok: true; rates: SpaRateInput[] } | { ok: false; error: string } {
  if (input == null) return { ok: true, rates: [] };
  if (!Array.isArray(input)) return { ok: false, error: "rates must be an array" };

  const rates: SpaRateInput[] = [];
  for (const r of input) {
    const effectiveFrom = r?.effectiveFrom ? new Date(r.effectiveFrom) : null;
    const effectiveTo = r?.effectiveTo ? new Date(r.effectiveTo) : null;
    if (!effectiveFrom || isNaN(effectiveFrom.getTime())) {
      return { ok: false, error: "Each price row needs a valid effective-from date" };
    }
    if (effectiveTo && isNaN(effectiveTo.getTime())) {
      return { ok: false, error: "Invalid effective-to date" };
    }
    const price = parseFloat(r?.price);
    if (isNaN(price) || price < 0) {
      return { ok: false, error: "Each price row needs a non-negative price" };
    }
    rates.push({ price, effectiveFrom, effectiveTo });
  }

  const overlapError = validateRateRanges(rates);
  if (overlapError) return { ok: false, error: overlapError };
  return { ok: true, rates };
}

// Finds the SpaTreatmentRate row covering a given date — same "row covering the date
// wins, no row = nothing to charge" convention as excursions.ts's rateForDate.
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

// Total price for the WHOLE appointment (all participants) against a resolved rate
// row — PER_PERSON multiplies by party size, FLAT is a package price regardless of
// how many guests share it (e.g. "Couple Massage"). Mirrors ExcursionType's
// PER_PERSON/FLAT split; see SPA_PLAN.md §3 row 7.
export function computeAppointmentTotal(rate: { price: number }, pricingMode: string, partySize: number): number {
  if (pricingMode === "FLAT") return rate.price;
  return rate.price * partySize;
}

// Combines SpaAppointment's separate date + "HH:MM" time-of-day fields into one real
// Date — for availability, cutoff-window, and no-show comparisons. Server-local time,
// same convention (and same known limitation — no property-timezone concept exists
// anywhere in this app) as excursions.ts's combineDepartureDateTime.
export function combineAppointmentDateTime(appointmentDate: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  const dt = new Date(appointmentDate);
  dt.setHours(hours || 0, minutes || 0, 0, 0);
  return dt;
}

// Adds `minutes` to an "HH:MM" time-of-day string, returning a new "HH:MM" string.
// Used to derive treatmentEndTime (startTime + duration) and blockedUntilTime
// (treatmentEndTime + cleanup buffer). Deliberately does not roll over past 23:59 —
// an appointment crossing midnight is out of scope for v1 (SPA_PLAN.md §15).
export function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(":").map(Number);
  const total = (hours || 0) * 60 + (mins || 0) + minutes;
  const clamped = Math.min(Math.max(total, 0), 23 * 60 + 59);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
