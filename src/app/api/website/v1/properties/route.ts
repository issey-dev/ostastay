import { websiteRoute, websitePreflight, apiJson } from "@/lib/website-api/http";
import { listPublicProperties } from "@/lib/website-api/property";

// Public Website API — see docs/WEBSITE_API.md. Every route here is key-authenticated
// (src/lib/website-api/resolve-key.ts), never session-authenticated, and reads live
// tenant data per request.
export const dynamic = "force-dynamic";

/** GET /api/website/v1/properties — every property this key may act on. */
export const GET = websiteRoute(async ({ key, cors }) => {
  const properties = await listPublicProperties(key.propertyIds);
  return apiJson({ properties }, { headers: cors });
});

export const OPTIONS = websitePreflight;
