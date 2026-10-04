import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { createManifestsFromSlots } from "@/lib/transport/manifests";

export const dynamic = "force-dynamic";

/** POST /transport/manifests/from-slots { serviceDate, direction, routeId? } → { created, skipped } */
export const POST = websiteRoute<{ propertyId: string }>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await createManifestsFromSlots(actor, params.propertyId, await readJsonBody(request)), { headers: cors });
});

export const OPTIONS = websitePreflight;
