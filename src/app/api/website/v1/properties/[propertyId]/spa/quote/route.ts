import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody } from "@/lib/website-api/http";
import { zodDetails } from "@/lib/website-api/schemas";
import { spaQuote, spaQuoteSchema } from "@/lib/website-api/spa";

export const dynamic = "force-dynamic";

/**
 * POST /api/website/v1/properties/{propertyId}/spa/quote
 * Body: { treatmentId, date, partySize? }
 * The authoritative price, computed by the posting code the booking uses. Writes nothing.
 */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const parsed = spaQuoteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  return apiJson(await spaQuote(key, params.propertyId, parsed.data), { headers: cors });
});

export const OPTIONS = websitePreflight;
