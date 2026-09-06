import { websiteRoute, websitePreflight, apiJson, apiError } from "@/lib/website-api/http";
import { keyCanAccessProperty } from "@/lib/website-api/resolve-key";
import { getPublicProperty } from "@/lib/website-api/property";

export const dynamic = "force-dynamic";

/** GET /api/website/v1/properties/{propertyId} — everything a property page needs. */
export const GET = websiteRoute<{ propertyId: string }>(async ({ key, params, cors }) => {
  // Not on the key's list reads as "not found", never "forbidden" — see resolve-key.ts.
  if (!keyCanAccessProperty(key, params.propertyId)) {
    return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });
  }
  const property = await getPublicProperty(params.propertyId);
  if (!property) return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });
  return apiJson({ property }, { headers: cors });
});

export const OPTIONS = websitePreflight;
