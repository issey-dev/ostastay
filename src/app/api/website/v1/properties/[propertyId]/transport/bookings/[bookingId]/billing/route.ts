import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { billingAction } from "@/lib/transport/billing";

export const dynamic = "force-dynamic";

/**
 * POST /transport/bookings/{bookingId}/billing
 *   { "action": "POST", "mode": "FULL" } | { "action": "POST", "mode": "CUSTOM", amount, reason, chargeCodeId?, description? }
 *   { "action": "WAIVE", reason } | { "action": "RESUME" }
 * VOID is refused for API keys (403 FORBIDDEN) — voids are folio corrections made at the desk.
 */
export const POST = websiteRoute<{ propertyId: string; bookingId: string }>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await billingAction(actor, params.propertyId, params.bookingId, await readJsonBody(request)), { headers: cors });
});

export const OPTIONS = websitePreflight;
