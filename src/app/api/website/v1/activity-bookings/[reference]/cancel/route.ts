import { z } from "zod";
import { websiteRoute, websitePreflight, apiJson, apiError, readJsonBody } from "@/lib/website-api/http";
import { zodDetails } from "@/lib/website-api/schemas";
import { cancelActivityBooking } from "@/lib/website-api/activity-bookings";

export const dynamic = "force-dynamic";

const cancelSchema = z.object({
  email: z.string().trim().email("A valid email is required"),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * POST /api/website/v1/activity-bookings/{reference}/cancel
 * Body: { email, reason? }
 * Guest self-cancel, until the free-cancellation deadline (409 CANCEL_CUTOFF_PASSED after
 * it). The charge comes off the bill; if the booking was paid online the response says
 * refundRequired: refund the guest through your own payment provider. Server-only keys.
 */
export const POST = websiteRoute<{ reference: string }>(async ({ request, key, params, cors }) => {
  const parsed = cancelSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return apiError(400, "VALIDATION", "Invalid request.", { details: zodDetails(parsed.error), headers: cors });
  return apiJson(await cancelActivityBooking(key, params.reference, parsed.data), { headers: cors });
});

export const OPTIONS = websitePreflight;
