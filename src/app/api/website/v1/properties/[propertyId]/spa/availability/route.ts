import { websiteRoute, websitePreflight, apiJson } from "@/lib/website-api/http";
import { spaAvailability } from "@/lib/website-api/spa";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/properties/{propertyId}/spa/availability?treatmentId=&date=YYYY-MM-DD[&partySize=][&gender=MALE|FEMALE]
 *     …or &from=YYYY-MM-DD&to=YYYY-MM-DD (at most 31 days) for which days have any time free.
 * Start times with a free therapist (per guest) and a free room, from the desk's own
 * engine. Therapists and rooms are never named.
 */
export const GET = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const s = new URL(request.url).searchParams;
  const result = await spaAvailability(key, params.propertyId, {
    treatmentId: s.get("treatmentId"),
    date: s.get("date"),
    from: s.get("from"),
    to: s.get("to"),
    partySize: s.get("partySize"),
    gender: s.get("gender"),
  });
  return apiJson(result, { headers: cors });
});

export const OPTIONS = websitePreflight;
