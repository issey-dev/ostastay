import { websiteRoute, websitePreflight, apiJson, apiError } from "@/lib/website-api/http";
import { keyCanAccessProperty } from "@/lib/website-api/resolve-key";
import { getPublicProperty } from "@/lib/website-api/property";
import { activityModuleStatus, keyHasScope, moduleStatus, type ModuleStatus } from "@/lib/website-api/scopes";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/properties/{propertyId} — everything a property page needs.
 *
 * `modules` says which of Rooms, Excursions and Spa this key can book at this property
 * right now, so a site can render only the sections that are live and pick up a module
 * the day the property switches it on, with no code change (BOOKING_API_ADDONS_PLAN.md).
 */
export const GET = websiteRoute<{ propertyId: string }>(async ({ key, params, cors }) => {
  // Not on the key's list reads as "not found", never "forbidden" — see resolve-key.ts.
  if (!keyCanAccessProperty(key, params.propertyId)) {
    return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });
  }
  const property = await getPublicProperty(params.propertyId);
  if (!property) return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });

  const rooms: ModuleStatus = !keyHasScope(key, "ROOMS")
    ? moduleStatus("SCOPE_NOT_GRANTED")
    : property.booking.enabled
      ? moduleStatus(null)
      : { enabled: false, code: "BOOKING_DISABLED", reason: property.booking.reason };
  const [excursions, spa] = await Promise.all([
    activityModuleStatus(key, params.propertyId, "EXCURSIONS"),
    activityModuleStatus(key, params.propertyId, "SPA"),
  ]);

  return apiJson({ property: { ...property, modules: { rooms, excursions, spa } } }, { headers: cors });
});

export const OPTIONS = websitePreflight;
