// Outlet type and tax-override choices the outlets API accepts. Kept out of the route
// files: Next only allows HTTP handlers and route config as exports of a route.ts, and
// exporting these from /api/outlets/route.ts would fail the production build's type check.
export const OUTLET_TYPES = ["SPA", "RESTAURANT", "BAR", "RETAIL", "TRANSPORT", "RECREATION", "OTHER"];
export const TAX_OVERRIDE_MODES = ["NONE", "DEFAULT_ENGINE", "CUSTOM"];
