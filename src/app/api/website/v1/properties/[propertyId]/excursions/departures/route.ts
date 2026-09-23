import { websiteRoute, websitePreflight, apiJson } from "@/lib/website-api/http";
import { excursionDepartures } from "@/lib/website-api/excursions";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/properties/{propertyId}/excursions/departures?from=YYYY-MM-DD&to=YYYY-MM-DD[&excursionId=]
 * Scheduled departures in [from, to] (at most 62 days) with live seats left — bookings and
 * other websites' holds already taken off — and when online booking for each closes.
 */
export const GET = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const { searchParams } = new URL(request.url);
  const result = await excursionDepartures(key, params.propertyId, {
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    excursionId: searchParams.get("excursionId"),
  });
  return apiJson(result, { headers: cors });
});

export const OPTIONS = websitePreflight;
