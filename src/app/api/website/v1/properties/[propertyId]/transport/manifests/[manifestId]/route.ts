import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { getManifest, updateManifest } from "@/lib/transport/manifests";

export const dynamic = "force-dynamic";

type P = { propertyId: string; manifestId: string };

/** GET / PATCH /transport/manifests/{manifestId} — read; change time, vessel, driver or status. */
export const GET = websiteRoute<P>(async ({ key, params, cors }) => {
  await transportGate(key, params.propertyId);
  return apiJson(await getManifest(params.propertyId, params.manifestId), { headers: cors });
});

export const PATCH = websiteRoute<P>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await updateManifest(actor, params.propertyId, params.manifestId, await readJsonBody(request)), { headers: cors });
});

export const OPTIONS = websitePreflight;
