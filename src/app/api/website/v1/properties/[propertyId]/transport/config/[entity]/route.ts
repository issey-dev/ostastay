import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { createConfig, isConfigEntity, listConfig } from "@/lib/transport/config";
import { notFound } from "@/lib/transport/common";

export const dynamic = "force-dynamic";

type P = { propertyId: string; entity: string };

/**
 * GET  /transport/config/{types|locations|routes|providers|vessels|rates}[?active=1]
 * POST /transport/config/{entity} — create (same fields and rules as the Hub)
 */
export const GET = websiteRoute<P>(async ({ request, key, params, cors }) => {
  await transportGate(key, params.propertyId, { operations: false });
  if (!isConfigEntity(params.entity)) throw notFound("Section");
  const active = new URL(request.url).searchParams.get("active") === "1";
  return apiJson({ data: await listConfig(params.propertyId, params.entity, { activeOnly: active }) }, { headers: cors });
});

export const POST = websiteRoute<P>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId, { operations: false });
  if (!isConfigEntity(params.entity)) throw notFound("Section");
  return apiJson(await createConfig(actor, params.propertyId, params.entity, await readJsonBody(request)), { status: 201, headers: cors });
});

export const OPTIONS = websitePreflight;
