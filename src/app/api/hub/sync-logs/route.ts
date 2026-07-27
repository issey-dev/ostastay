import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { listSyncLogs } from "@/lib/channels/sync-log";

// The Hub's channel-manager exchange log — inbound and outbound, for troubleshooting.
// See .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Read-only by design: entries are written by the sync path itself, never by a client, and
// there is deliberately no delete endpoint — a log an operator can quietly erase is not
// much of a troubleshooting record. Retention is a scheduled prune (pruneSyncLogs), not a
// button.
//
// Gated on "view" and, as everywhere in the Hub, requireHubAccess() as well: a
// PROPERTY-scoped user is refused outright regardless of their role bits.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const result = await listSyncLogs(ctx.enterpriseId, {
      connectionId: searchParams.get("connectionId") ?? undefined,
      direction: searchParams.get("direction") ?? undefined,
      outcome: searchParams.get("outcome") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
