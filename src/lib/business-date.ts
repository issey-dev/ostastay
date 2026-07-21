// The property BUSINESS DATE — the operational "today" that drives check-in/out
// gating, arrivals/departures, and the date every Night Audit posting is stamped
// with. It only moves forward when Night Audit (EOD) is run for the property
// (Property.businessDate). This is distinct from EnterpriseSettings.systemDate,
// which is the real server/wall-clock date.
//
// Reservation dates are stored as UTC midnights (forms submit plain YYYY-MM-DD),
// so every business-date value is normalized to UTC midnight and all comparisons
// here are date-only.

/** Normalize any Date to that calendar day's UTC midnight. */
export function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The real server/wall-clock date as a UTC midnight — the fallback and the
 *  reference an Auto-EOD would eventually compare the business date against. */
export function serverToday(): Date {
  return toUtcMidnight(new Date());
}

/** The property's business date, or the server date if it hasn't been initialized
 *  (pre-migration rows / a property that has never run an audit). Always UTC midnight. */
export function resolveBusinessDate(property: { businessDate?: Date | null }): Date {
  return property.businessDate ? toUtcMidnight(property.businessDate) : serverToday();
}

/** The next business date — where EOD rolls the property to on a successful audit. */
export function nextBusinessDate(d: Date): Date {
  const midnight = toUtcMidnight(d);
  return new Date(midnight.getTime() + 24 * 60 * 60 * 1000);
}
