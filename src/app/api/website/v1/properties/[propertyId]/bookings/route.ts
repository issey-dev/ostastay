import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody, requestIp } from "@/lib/website-api/http";
import { keyCanAccessProperty } from "@/lib/website-api/resolve-key";
import { websiteBookingSchema, zodDetails } from "@/lib/website-api/schemas";
import { createWebsiteBooking } from "@/lib/website-api/booking";

export const dynamic = "force-dynamic";

/**
 * POST /api/website/v1/properties/{propertyId}/bookings
 * Body: { checkIn, checkOut, roomTypeId, adults, children, guest: { firstName, lastName,
 *         email, phone }, remarks?, idempotencyKey? }
 * Header (recommended): Idempotency-Key: <unique per attempt>
 *
 * Creates a real RESERVED reservation through the same service the front desk uses. A stay
 * that no longer fits is refused (SOLD_OUT / STOP_SALE) — the website can never overbook.
 * See src/lib/website-api/booking.ts.
 */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  if (!keyCanAccessProperty(key, params.propertyId)) {
    return apiError(404, "PROPERTY_NOT_FOUND", "Property not found.", { headers: cors });
  }
  const parsed = websiteBookingSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  }
  const { guest, remarks, idempotencyKey: bodyKey, ...stay } = parsed.data;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || bodyKey || null;

  const result = await createWebsiteBooking({
    key,
    propertyId: params.propertyId,
    stay,
    guest: { firstName: guest.firstName, lastName: guest.lastName ?? null, email: guest.email, phone: guest.phone ?? null },
    remarks: remarks ?? null,
    idempotencyKey,
    requestIp: requestIp(request),
  });
  if (!result.ok) return apiError(result.status, result.code, result.error, { headers: cors });
  return apiJson({ booking: result.booking }, { status: result.booking.replayed ? 200 : 201, headers: cors });
});

export const OPTIONS = websitePreflight;
