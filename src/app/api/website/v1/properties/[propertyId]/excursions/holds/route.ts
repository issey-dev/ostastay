import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody, requestIp } from "@/lib/website-api/http";
import { zodDetails } from "@/lib/website-api/schemas";
import { createExcursionHold, holdSchema } from "@/lib/website-api/excursions";

export const dynamic = "force-dynamic";

/**
 * POST /api/website/v1/properties/{propertyId}/excursions/holds
 * Body: { departureId, adults, children?, infants? }
 * Keeps the seats for the property's hold time while your site takes payment; then book
 * with the holdId. An unused hold simply expires. Server-only keys.
 */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const parsed = holdSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  const result = await createExcursionHold(key, params.propertyId, parsed.data, requestIp(request));
  return apiJson(result, { status: 201, headers: cors });
});

export const OPTIONS = websitePreflight;
