import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { quoteBooking } from "@/lib/transport/bookings";

export const dynamic = "force-dynamic";

/** POST /transport/quote — the rate a booking would get and its folio total (tax included). */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  await transportGate(key, params.propertyId);
  return apiJson(await quoteBooking(params.propertyId, await readJsonBody(request)), { headers: cors });
});

export const OPTIONS = websitePreflight;
