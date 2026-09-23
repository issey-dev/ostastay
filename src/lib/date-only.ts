import { format } from "date-fns"

// ─── Date-only values on the client ──────────────────────────────────────────
// A check-in date, a report's "from", a go-live date — these are calendar DAYS, not
// instants. The app carries them as "yyyy-MM-dd" strings, and the database stores them
// as UTC midnight (`new Date("2026-09-23")` on the server).
//
// The calendar component hands back LOCAL midnight, and the app runs at UTC+5. Turning
// that into a string with `toISOString()` converts to UTC first, which is 19:00 the day
// BEFORE — the "I picked the 23rd and got the 22nd" bug. Always go through these two
// helpers instead: they never cross a time zone.

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})/

/** A Date (as the calendar returns it: local midnight) → "yyyy-MM-dd", in local time. */
export function toDateKey(d: Date): string {
  return format(d, "yyyy-MM-dd")
}

/** Today's date as the user's clock sees it, "yyyy-MM-dd". */
export function todayKey(): string {
  return toDateKey(new Date())
}

/**
 * Anything that names a day → a Date at LOCAL midnight of that same day, which is what
 * the calendar expects to highlight.
 *   · "2026-09-23" / "2026-09-23T00:00:00.000Z" (a DB date) → the 23rd. The leading
 *     yyyy-MM-dd is read as-is; the time part is ignored rather than converted.
 *   · a Date at exactly UTC midnight (a DB date already wrapped in `new Date`) → its UTC
 *     day, so it does not slide to the previous day west of Greenwich.
 *   · any other Date → its local day.
 */
export function parseDateKey(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined
  if (typeof value === "string") {
    const m = DATE_KEY.exec(value)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    const d = new Date(value)
    return isNaN(d.getTime()) ? undefined : new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }
  if (isNaN(value.getTime())) return undefined
  const utcMidnight =
    value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0
  return utcMidnight
    ? new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
    : new Date(value.getFullYear(), value.getMonth(), value.getDate())
}
