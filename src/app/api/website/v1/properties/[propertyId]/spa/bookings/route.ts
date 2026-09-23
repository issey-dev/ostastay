import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody, requestIp } from "@/lib/website-api/http";
import { zodDetails } from "@/lib/website-api/schemas";
import { idempotencyKeySchema } from "@/lib/website-api/activity-common";
import { bookSpa, spaBookSchema } from "@/lib/website-api/spa";

export const dynamic = "force-dynamic";

/**
 * POST /api/website/v1/properties/{propertyId}/spa/bookings
 * Header: Idempotency-Key: <unique per booking attempt> (required)
 * Body: { holdId | (treatmentId, date, startTime, partySize?, gender?), guest,
 *         companions?, payment, expectedTotal?, remarks? }
 *
 * Instant: CONFIRMED if a therapist per guest and a room are free, refused
 * (SLOT_UNAVAILABLE) otherwise. The charge posts at once; PAID settles it with the
 * property's online payment method. Same Idempotency-Key, same booking. Server-only keys.
 */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const raw = (await readJsonBody(request)) as Record<string, unknown> | null;
  const idem = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key") ?? raw?.idempotencyKey ?? "");
  if (!idem.success) {
    return apiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send a unique Idempotency-Key header (8 to 128 characters) with every booking.", {
      headers: cors,
    });
  }
  const parsed = spaBookSchema.safeParse(raw);
  if (!parsed.success) return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  const result = await bookSpa(key, params.propertyId, parsed.data, idem.data, requestIp(request));
  return apiJson(result.body, { status: result.status, headers: cors });
});

export const OPTIONS = websitePreflight;
