// Derived Rate Plans resolve their per-night price live from a parent plan's
// PriceCalendar entry plus a percent/flat adjustment — never materialized into their
// own PriceCalendar rows. Shared by the Price Calendar display route and Night Audit
// so both apply the exact same formula.
export function applyRateAdjustment(
  parentPrice: number,
  adjustmentType: string,
  adjustmentValue: number
): number {
  if (adjustmentType === "PERCENT") {
    return Math.round(parentPrice * (1 + adjustmentValue / 100) * 100) / 100;
  }
  // FLAT
  return Math.round((parentPrice + adjustmentValue) * 100) / 100;
}
