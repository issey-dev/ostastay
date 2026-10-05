import { websitePreflight, apiJson, readJsonBody, websiteRoute } from "@/lib/website-api/http";
import { transportGate } from "@/lib/website-api/transport";
import { deleteConfig, getConfig, isConfigEntity, updateConfig } from "@/lib/transport/config";
import { notFound } from "@/lib/transport/common";

export const dynamic = "force-dynamic";

type P = { propertyId: string; entity: string; id: string };

/**
 * GET    /transport/config/{entity}/{id}
 * PATCH  /transport/config/{entity}/{id} — partial update; { "isActive": false } deactivates
 * DELETE /transport/config/{entity}/{id} — only while unreferenced, else 409 IN_USE
 */
export const GET = websiteRoute<P>(async ({ key, params, cors }) => {
  await transportGate(key, params.propertyId, { operations: false });
  if (!isConfigEntity(params.entity)) throw notFound("Section");
  return apiJson(await getConfig(params.propertyId, params.entity, params.id), { headers: cors });
});

export const PATCH = websiteRoute<P>(async ({ request, key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId, { operations: false });
  if (!isConfigEntity(params.entity)) throw notFound("Section");
  return apiJson(await updateConfig(actor, params.propertyId, params.entity, params.id, await readJsonBody(request)), { headers: cors });
});

export const DELETE = websiteRoute<P>(async ({ key, params, cors }) => {
  const actor = await transportGate(key, params.propertyId, { operations: false });
  if (!isConfigEntity(params.entity)) throw notFound("Section");
  return apiJson(await deleteConfig(actor, params.propertyId, params.entity, params.id), { headers: cors });
});

export const OPTIONS = websitePreflight;
