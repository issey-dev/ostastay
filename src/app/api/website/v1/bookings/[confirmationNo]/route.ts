import { websiteRoute, websitePreflight, apiJson, apiError } from "@/lib/website-api/http";
import { lookupWebsiteBooking } from "@/lib/website-api/booking";

export const dynamic = "force-dynamic";

/**
 * GET /api/website/v1/bookings/{confirmationNo}?email=guest@example.com
 *
 * A "manage my booking" lookup. Only bookings made through THIS key are visible, and the
 * guest's email must match — a confirmation number alone is printed on paperwork and is
 * not a secret.
 */
export const GET = websiteRoute<{ confirmationNo: string }>(async ({ request, key, params, cors }) => {
  const email = new URL(request.url).searchParams.get("email") ?? "";
  if (!email.trim()) return apiError(400, "VALIDATION", "email is required.", { headers: cors });
  const result = await lookupWebsiteBooking({ key, confirmationNo: params.confirmationNo, email });
  if (!result.ok) return apiError(result.status, result.code, result.error, { headers: cors });
  return apiJson({ booking: result.booking }, { headers: cors });
});

export const OPTIONS = websitePreflight;
