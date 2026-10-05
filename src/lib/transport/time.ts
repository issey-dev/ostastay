// Transportation times: stored as UTC instants, entered and shown in the PROPERTY's time
// zone (Indian/Maldives for every live property). The board's day is the property's local
// day, stored as UTC midnight like every other date-only column (serviceDate).
//
// Pure — usable on the server and in tests. The client never converts: the API returns the
// local "yyyy-MM-dd" / "HH:MM" strings alongside the instants.

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/
const HHMM = /^(\d{2}):(\d{2})$/

/** Offset of `timeZone` from UTC at `instant`, in minutes (Maldives: +300). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return Math.round((asUtc - instant.getTime()) / 60_000)
}

/** A local day + "HH:MM" in `timeZone` → the UTC instant. */
export function localToUtc(dateKey: string, hhmm: string, timeZone: string): Date {
  const d = DATE_KEY.exec(dateKey)
  const t = HHMM.exec(hhmm)
  if (!d || !t) throw new Error(`Invalid local date/time: ${dateKey} ${hhmm}`)
  const naive = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]))
  // Two passes settle a DST edge; one is exact for fixed-offset zones like Maldives.
  let guess = naive - tzOffsetMinutes(new Date(naive), timeZone) * 60_000
  guess = naive - tzOffsetMinutes(new Date(guess), timeZone) * 60_000
  return new Date(guess)
}

/** A UTC instant → its local day and "HH:MM" in `timeZone`. */
export function utcToLocal(instant: Date, timeZone: string): { dateKey: string; time: string } {
  const local = new Date(instant.getTime() + tzOffsetMinutes(instant, timeZone) * 60_000)
  const iso = local.toISOString()
  return { dateKey: iso.slice(0, 10), time: iso.slice(11, 16) }
}

/** "yyyy-MM-dd" → UTC midnight (the date-only storage convention). */
export function dateKeyToDate(dateKey: string): Date {
  const d = DATE_KEY.exec(dateKey)
  if (!d) throw new Error(`Invalid date: ${dateKey}`)
  return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])))
}

/** A date-only column (UTC midnight) → "yyyy-MM-dd". */
export function dateToKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDaysKey(dateKey: string, days: number): string {
  return dateToKey(new Date(dateKeyToDate(dateKey).getTime() + days * 86_400_000))
}

/** The local day of `instant` as UTC midnight — a service date from a departure time. */
export function localServiceDate(instant: Date, timeZone: string): Date {
  return dateKeyToDate(utcToLocal(instant, timeZone).dateKey)
}
