import { BookingError } from "@/lib/booking-error";
import { keyCanAccessProperty, type ResolvedWebsiteKey } from "@/lib/website-api/resolve-key";
import { requireScope } from "@/lib/website-api/scopes";
import { apiActor, getTransportSettings, type TransportActor } from "@/lib/transport/common";

// The Booking API's Transportation endpoints (/api/website/v1/properties/{id}/transport/**):
// a TRANSPORT-scoped key may read and manage one property's transfer operations the way the
// desk does — through the SAME services (src/lib/transport/*), so a transfer booked, put on a
// departure or charged through the API behaves exactly as one made at the desk.
//
// Who may do what, in order (the activityGate shape):
//  - a property not on the key → 404 PROPERTY_NOT_FOUND (never 403 — keys cannot probe);
//  - no TRANSPORT scope → 403 SCOPE_NOT_GRANTED;
//  - a key with browser origins → 403 SERVER_KEY_REQUIRED (guest data and billing; the Hub
//    also refuses to give such a key the scope);
//  - operations (not configuration) at a property with Transportation off → 409
//    MODULE_NOT_ENABLED.
// The key acts as the enterprise's "Online Bookings" system user: it may post and waive
// charges, never void one (folio corrections stay at the desk).

export async function transportGate(
  key: ResolvedWebsiteKey,
  propertyId: string,
  opts: { operations: boolean } = { operations: true }
): Promise<TransportActor> {
  if (!keyCanAccessProperty(key, propertyId)) throw new BookingError(404, "PROPERTY_NOT_FOUND", "Property not found.");
  requireScope(key, "TRANSPORT");
  if (key.allowedOrigins.length > 0) {
    throw new BookingError(403, "SERVER_KEY_REQUIRED", "Transportation must be called from your server with a server-only key (no browser origins).");
  }
  if (opts.operations) {
    const settings = await getTransportSettings(propertyId);
    if (!settings.enabled) {
      throw new BookingError(409, "MODULE_NOT_ENABLED", "Transportation is not switched on for this property.", { details: { reason: "NOT_ENABLED" } });
    }
  }
  return apiActor(key.enterpriseId);
}

/** ?limit= for list endpoints: 1–200, default 100. */
export function limitFrom(sp: URLSearchParams): number {
  const n = Number(sp.get("limit") ?? 100);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 200) : 100;
}
