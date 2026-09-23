import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody, requestIp } from "@/lib/website-api/http";
import { zodDetails } from "@/lib/website-api/schemas";
import { idempotencyKeySchema } from "@/lib/website-api/activity-common";
import { bookExcursion, bookSchema } from "@/lib/website-api/excursions";

export const dynamic = "force-dynamic";

/**
 * POST /api/website/v1/properties/{propertyId}/excursions/bookings
 * Header: Idempotency-Key: <unique per booking attempt> (required)
 * Body: { holdId | (departureId, adults, children?, infants?), guest, payment,
 *         expectedTotal?, remarks? }
 *
 * Instant: CONFIRMED if the seats are there, refused (SOLD_OUT...) otherwise. Booked with
 * the desk's own booking code; a PAID booking is settled on the bill with the property's
 * online payment method. Retry with the same Idempotency-Key and you get the same booking
 * back (200, replayed: true), never a second one. Server-only keys.
 */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const raw = (await readJsonBody(request)) as Record<string, unknown> | null;
  const idem = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key") ?? raw?.idempotencyKey ?? "");
  if (!idem.success) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send a unique Idempotency-Key header (8 to 128 characters) with every booking.", {
      headers: cors,
    });
  }
  const parsed = bookSchema.safeParse(raw);
  if (!parsed.success) return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  const result = await bookExcursion(key, params.propertyId, parsed.data, idem.data, requestIp(request));
  return apiJson(result.body, { status: result.status, headers: cors });
});

export const OPTIONS = websitePreflight;
