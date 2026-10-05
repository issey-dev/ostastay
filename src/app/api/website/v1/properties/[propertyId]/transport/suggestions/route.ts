import { websitePreflight, apiJson, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { transportSuggestions } from "@/lib/transport/bookings";
import { invalid } from "@/lib/transport/common";
import { DATE_KEY } from "@/lib/transport/constants";

export const dynamic = "force-dynamic";

/** GET /transport/suggestions?from=&to= — arrivals/departures with no transfer booked (nothing is created). */
export const GET = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  await transportGate(key, params.propertyId);
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") || from;
  if (!DATE_KEY.test(from) || !DATE_KEY.test(to)) throw invalid("from/to are required (YYYY-MM-DD)");
  return apiJson({ data: await transportSuggestions(params.propertyId, from, to) }, { headers: cors });
});

export const OPTIONS = websitePreflight;
