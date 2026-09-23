import { websiteRoute, websitePreflight, apiJson } from "@/lib/website-api/http";
import { spaCatalogue } from "@/lib/website-api/spa";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/properties/{propertyId}/spa/treatments
 * The treatments this property sells online, grouped by category, with today's prices and
 * the online booking rules. Needs the SPA scope.
 */
export const GET = websiteRoute<{ propertyId: string }>(async ({ key, params, cors }) => {
  return apiJson(await spaCatalogue(key, params.propertyId), { headers: cors });
});

export const OPTIONS = websitePreflight;
