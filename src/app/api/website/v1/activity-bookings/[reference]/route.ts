import { websiteRoute, websitePreflight, apiJson } from "@/lib/website-api/http";
import { lookupActivityBooking } from "@/lib/website-api/activity-bookings";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/activity-bookings/{reference}?email=
 * "My booking" for an excursion (and, from Phase 3, spa) booking made with this key: the
 * live status, including anything the property changed, and whether it can still be
 * cancelled online. The email must match the one booked with.
 */
export const GET = websiteRoute<{ reference: string }>(async ({ request, key, params, cors }) => {
  const email = new URL(request.url).searchParams.get("email");
  return apiJson(await lookupActivityBooking(key, params.reference, email), { headers: cors });
});

export const OPTIONS = websitePreflight;
