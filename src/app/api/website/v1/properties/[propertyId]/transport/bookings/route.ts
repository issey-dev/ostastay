import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate, limitFrom } from "@/lib/website-api/transport";
import { createBooking, listBookings } from "@/lib/transport/bookings";
import { bookingFiltersFrom } from "@/lib/transport/http";

export const dynamic = "force-dynamic";

type P = { propertyId: string };

/**
 * GET /transport/bookings?from=&to=&direction=&status=&reservationId=&manifestId=&q=&unassigned=1&attention=1&limit=&cursor=
 *   Cursor-paginated: { data, nextCursor } — pass nextCursor back as cursor for the next page.
 * POST /transport/bookings — create (reservationId, or guestName for a traveller without a stay)
 */
export const GET = websiteRoute<P>(async ({ request, key, params, cors }) => {
  await transportGate(key, params.propertyId);
  const sp = new URL(request.url).searchParams;
  const { items, nextCursor } = await listBookings(params.propertyId, { ...bookingFiltersFrom(sp), limit: limitFrom(sp) });
  return apiJson({ data: items, nextCursor }, { headers: cors });
});

export const POST = websiteRoute<P>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await createBooking(actor, params.propertyId, await readJsonBody(request)), { status: 201, headers: cors });
});

export const OPTIONS = websitePreflight;
