import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody } from "@/lib/website-api/http";
import { keyCanAccessProperty } from "@/lib/website-api/resolve-key";
import { websiteStaySchema, zodDetails } from "@/lib/website-api/schemas";
import { quoteWebsiteStay } from "@/lib/website-api/booking";

export const dynamic = "force-dynamic";

/**
 * POST /api/website/v1/properties/{propertyId}/quote
 * Body: { checkIn, checkOut, roomTypeId, adults, children }
 *
 * The authoritative price for a stay — taxes, service charge, Green Tax and package
 * allocations included — computed by the same code Night Audit posts with
 * (src/lib/reservation-quote-server.ts). Never writes. Show THIS total on the booking
 * page; the availability calendar's nightly figure is the room rate only.
 */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  if (!keyCanAccessProperty(key, params.propertyId)) {
    return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });
  }
  const parsed = websiteStaySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  }

  const result = await quoteWebsiteStay(params.propertyId, parsed.data);
  if (!result.ok) return apiError(result.status, result.code, result.error, { headers: cors });
  return apiJson({ quote: result.quote }, { headers: cors });
});

export const OPTIONS = websitePreflight;
