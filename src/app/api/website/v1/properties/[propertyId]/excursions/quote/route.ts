import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody } from "@/lib/website-api/http";
import { zodDetails } from "@/lib/website-api/schemas";
import { excursionQuote, quoteSchema } from "@/lib/website-api/excursions";

export const dynamic = "force-dynamic";

/**
 * POST /api/website/v1/properties/{propertyId}/excursions/quote
 * Body: { departureId, adults, children?, infants? }
 * The authoritative price — computed by the same posting code the booking uses, so the
 * booking posts exactly this total. Writes nothing.
 */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const parsed = quoteSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  return apiJson(await excursionQuote(key, params.propertyId, parsed.data), { headers: cors });
});

export const OPTIONS = websitePreflight;
