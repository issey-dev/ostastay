import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { changeManifestBookings } from "@/lib/transport/manifests";

export const dynamic = "force-dynamic";

/** POST /transport/manifests/{manifestId}/bookings { action: ATTACH | DETACH | KEEP, bookingIds } */
export const POST = websiteRoute<{ propertyId: string; manifestId: string }>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await changeManifestBookings(actor, params.propertyId, params.manifestId, await readJsonBody(request)), { headers: cors });
});

export const OPTIONS = websitePreflight;
