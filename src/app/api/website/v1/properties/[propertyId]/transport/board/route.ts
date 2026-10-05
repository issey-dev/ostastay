import { websitePreflight, apiJson, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { boardData } from "@/lib/transport/board";
import { bookingFiltersFrom } from "@/lib/transport/http";
import { invalid } from "@/lib/transport/common";
import { DATE_KEY } from "@/lib/transport/constants";

export const dynamic = "force-dynamic";

/** GET /transport/board?date=YYYY-MM-DD[&filters] — the day's bookings and departures + week counts. */
export const GET = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  await transportGate(key, params.propertyId);
  const sp = new URL(request.url).searchParams;
  const date = sp.get("date") ?? "";
  if (!DATE_KEY.test(date)) throw invalid("date is required (YYYY-MM-DD)");
  return apiJson(await boardData(params.propertyId, date, bookingFiltersFrom(sp)), { headers: cors });
});

export const OPTIONS = websitePreflight;
