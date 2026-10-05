import { websitePreflight, apiJson, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { transportReportResult } from "@/lib/transport/report";
import { invalid } from "@/lib/transport/common";
import { DATE_KEY } from "@/lib/transport/constants";
import { addDaysKey } from "@/lib/transport/time";

export const dynamic = "force-dynamic";

/** GET /transport/report?from=&to= — the Daily Transportation Report's data (≤ 62 days), as JSON. */
export const GET = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  await transportGate(key, params.propertyId);
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") || from;
  if (!DATE_KEY.test(from) || !DATE_KEY.test(to) || to < from) throw invalid("from/to are required (YYYY-MM-DD), to on or after from");
  if (addDaysKey(from, 62) < to) throw invalid("At most 62 days at a time");
  return apiJson(await transportReportResult(params.propertyId, from, to), { headers: cors });
});

export const OPTIONS = websitePreflight;
