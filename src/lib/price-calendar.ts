// Shared cap for any date-range bulk-pricing action (both /api/price-calendar and
// /api/price-calendar/bulk) — each builds one row per room type per day, so an
// unbounded range risks a very large transaction. 10 years covers realistic
// seasonal-pricing horizons (e.g. loading several years of contracted corporate rates
// at once).
export const MAX_PRICE_CALENDAR_RANGE_YEARS = 10;
export const MAX_PRICE_CALENDAR_RANGE_DAYS = 365 * MAX_PRICE_CALENDAR_RANGE_YEARS;
