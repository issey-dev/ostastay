import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { createManifest, listManifests } from "@/lib/transport/manifests";

export const dynamic = "force-dynamic";

type P = { propertyId: string };

/**
 * GET  /transport/manifests?from=&to=&direction=&routeId=&includeCancelled=1 — departures with passengers
 * POST /transport/manifests — create a departure (optionally with bookingIds)
 */
export const GET = websiteRoute<P>(async ({ request, key, params, cors }) => {
  await transportGate(key, params.propertyId);
  const sp = new URL(request.url).searchParams;
  const data = await listManifests(params.propertyId, {
    from: sp.get("from"),
    to: sp.get("to"),
    direction: sp.get("direction"),
    routeId: sp.get("routeId"),
    includeCancelled: sp.get("includeCancelled") === "1",
  });
  return apiJson({ data }, { headers: cors });
});

export const POST = websiteRoute<P>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId);
  return apiJson(await createManifest(actor, params.propertyId, await readJsonBody(request)), { status: 201, headers: cors });
});

export const OPTIONS = websitePreflight;
