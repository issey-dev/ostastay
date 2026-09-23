import { websiteRoute, websitePreflight, apiJson } from "@/lib/website-api/http";
import { excursionCatalogue } from "@/lib/website-api/excursions";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/properties/{propertyId}/excursions
 * The excursions this property sells online, with today's prices and the online booking
 * rules (hold time, book-ahead time, largest party, policies). Needs the EXCURSIONS scope.
 */
export const GET = websiteRoute<{ propertyId: string }>(async ({ key, params, cors }) => {
  return apiJson(await excursionCatalogue(key, params.propertyId), { headers: cors });
});

export const OPTIONS = websitePreflight;
