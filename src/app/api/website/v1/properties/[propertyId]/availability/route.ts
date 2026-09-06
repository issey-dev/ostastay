import { websiteRoute, websitePreflight, apiJson, apiError } from "@/lib/website-api/http";
import { keyCanAccessProperty } from "@/lib/website-api/resolve-key";
import { computeWebsiteAvailability } from "@/lib/website-api/availability";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/properties/{propertyId}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Per room type, per night in [from, to): rooms available (clamped to 0), whether the
 * night is closed by a stop-sale, and the calendar price on the rate plan the Hub chose.
 * Implements the D-7 publication rules — see src/lib/website-api/availability.ts.
 */
export const GET = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  if (!keyCanAccessProperty(key, params.propertyId)) {
    return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });
  }
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!from || !to) {
    return apiError(400, "INVALID_DATES", "from and to (YYYY-MM-DD) are required.", { headers: cors });
  }

  const result = await computeWebsiteAvailability({ propertyId: params.propertyId, from, to });
  if (!result.ok) return apiError(result.status, result.code, result.error, { headers: cors });
  return apiJson(result.availability, { headers: cors });
});

export const OPTIONS = websitePreflight;
