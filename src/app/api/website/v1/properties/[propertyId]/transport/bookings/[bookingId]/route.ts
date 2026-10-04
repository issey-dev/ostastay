import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { getBooking, updateBooking } from "@/lib/transport/bookings";

export const dynamic = "force-dynamic";

type P = { propertyId: string; bookingId: string };

/** GET / PATCH /transport/bookings/{bookingId} — read, or change any booking field. */
export const GET = websiteRoute<P>(async ({ key, params, cors }) => {
  await transportGate(key, params.propertyId);
  return apiJson(await getBooking(params.propertyId, params.bookingId), { headers: cors });
});

export const PATCH = websiteRoute<P>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await updateBooking(actor, params.propertyId, params.bookingId, await readJsonBody(request)), { headers: cors });
});

export const OPTIONS = websitePreflight;
