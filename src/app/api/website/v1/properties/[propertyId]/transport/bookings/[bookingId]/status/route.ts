import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { setBookingStatus } from "@/lib/transport/bookings";

export const dynamic = "force-dynamic";

/** POST /transport/bookings/{bookingId}/status { status, reason? } → { booking, note } */
export const POST = websiteRoute<{ propertyId: string; bookingId: string }>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await setBookingStatus(actor, params.propertyId, params.bookingId, await readJsonBody(request)), { headers: cors });
});

export const OPTIONS = websitePreflight;
