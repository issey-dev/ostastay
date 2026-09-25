// Dates relative to the real clock, for tests whose code under test compares against
// "now" (the server date is the arrival floor when a property has no business date, group
// cutoffs, link expiries, ...). A fixed literal like "2026-10-01" passes until the calendar
// reaches it and then fails for no code reason, so such tests use these instead.

/** The UTC calendar day `offset` days from today, as "yyyy-MM-dd". */
export function isoDaysFromToday(offset: number): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset))
    .toISOString()
    .slice(0, 10);
}

/** The UTC midnight `offset` days from today. */
export function utcDaysFromToday(offset: number): Date {
  return new Date(`${isoDaysFromToday(offset)}T00:00:00.000Z`);
}
