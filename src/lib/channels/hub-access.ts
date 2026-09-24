import { prisma } from "@/lib/db";
import { ForbiddenError, requirePropertySetup, type AuthContext } from "@/lib/scope";
import type { Action } from "@/lib/modules";

// The customer Hub's channel-manager routes are PROPERTY setup since 2026-09-23 (one
// connection per property — .agents/docs/HUB_SETUP_PLAN.md, Phase 4): every read and every
// edit is authorised against the property the connection, link or booking belongs to —
// Property Setup there with INTEGRATIONS — so a single-property admin works their own
// property's channel manager and never sees another's. Connecting, disconnecting and
// re-authorising stay with Uppsolut (src/app/api/osta/channels/**).

/** The link, once the caller may act on its property. Generic "not found" otherwise. */
export async function authorizeLink(ctx: AuthContext, linkId: string, action: Action) {
  const link = await prisma.channelPropertyLink.findUnique({ where: { id: linkId }, include: { connection: true } });
  if (!link || link.connection.enterpriseId !== ctx.enterpriseId) throw new ForbiddenError("Link not found");
  await requirePropertySetup(ctx, link.propertyId, "INTEGRATIONS", action);
  return link;
}

/** The connection, once the caller may act on its property. Generic "not found" otherwise. */
export async function authorizeConnection(ctx: AuthContext, connectionId: string, action: Action) {
  const connection = await prisma.channelConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.enterpriseId !== ctx.enterpriseId) throw new ForbiddenError("Connection not found");
  await requirePropertySetup(ctx, connection.propertyId, "INTEGRATIONS", action);
  return connection;
}

/** ?propertyId= from a list route, once the caller may set that property up. */
export async function authorizePropertyParam(ctx: AuthContext, request: Request, action: Action): Promise<string> {
  const propertyId = new URL(request.url).searchParams.get("propertyId");
  if (!propertyId) throw new ForbiddenError("propertyId is required");
  await requirePropertySetup(ctx, propertyId, "INTEGRATIONS", action);
  return propertyId;
}
