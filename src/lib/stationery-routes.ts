// Path suffixes that identify a printable stationery document — Invoice, Payment
// Receipt, Exchange Receipt, Registration Card, Confirmation Letter, Debtor Statement.
// These pages are nested under the dashboard layout for auth/property-gating, but must
// render chrome-free (no sidebar/header) even when just being viewed on screen, not
// only during @media print. Add a new suffix here when a new stationery type ships.
const STATIONERY_PATH_SUFFIXES = [
  "/print",
  "/receipt",
  "/confirmation-letter",
  "/registration-card",
  "/statement",
] as const

export function isStationeryRoute(pathname: string): boolean {
  return STATIONERY_PATH_SUFFIXES.some((suffix) => pathname.endsWith(suffix))
}
