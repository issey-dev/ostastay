import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { listConnections, createConnection } from "@/lib/channels/connection";
import { ChannelAuthError, ChannelApiError } from "@/lib/channels/beds24";

// Channel-manager connections for the session's own enterprise — see
// .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md.
//
// Every handler in the Hub calls requireHubAccess(ctx) IN ADDITION to requirePermission().
// The two are not redundant: requireHubAccess enforces the enterprise-level rule (a
// PROPERTY-scoped user is refused outright, whatever their role bits say), while
// requirePermission enforces the per-action CRUD bit. The Hub layout's own check guards
// the UI shell only and is no substitute for either.

// A stored channel-manager credential can move real inventory and accept real bookings.
// It is therefore WRITE-ONLY from the browser's point of view: nothing here ever returns a
// token, and there is deliberately no endpoint that reveals one.

export async function GET() {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    return NextResponse.json({ connections: await listConnections(ctx.enterpriseId) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "create");

    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";

    if (!name) {
      return NextResponse.json({ error: "A connection name is required" }, { status: 400 });
    }
    if (!inviteCode) {
      return NextResponse.json({ error: "An invite code is required" }, { status: 400 });
    }

    const connection = await createConnection({ enterpriseId: ctx.enterpriseId, name, inviteCode });

    // The invite code itself is never logged — only that a connection was established.
    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "CREATE",
      description: `Connected channel manager "${name}" (Beds24)`,
      entityType: "ChannelConnection",
      entityId: connection.id,
    });

    return NextResponse.json({ connection }, { status: 201 });
  } catch (error) {
    // A rejected invite code is the operator's mistake, not a server fault — surface the
    // real reason with a 4xx instead of letting it fall through to a generic 500.
    if (error instanceof ChannelAuthError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ChannelApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    // Prisma's unique constraint on (enterpriseId, name).
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "A connection with that name already exists" }, { status: 409 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
