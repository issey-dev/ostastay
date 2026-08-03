import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { listConnections } from "@/lib/channels/connection";

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

// Establishing the Beds24 link is an OSTA-LEVEL action, not a tenant one (app-owner
// decision, 2026-08-03): under the master-account topology the invite code comes from
// the app owner's own Beds24 account, so the tenant never holds one and must not be able
// to mint, replace, or delete a connection. Refused here rather than only hidden in the
// UI — a hidden button is not a control. The Hub keeps everything downstream of the
// link: mapping, inbound bookings, its own exchange logs, and a read-only health view.
//
// The platform-side equivalents live under /api/osta/channels/connections.
const OSTA_MANAGED =
  "Channel-manager connections are set up by Osta. Contact Osta to connect or change this enterprise's channel manager.";

export async function POST() {
  return NextResponse.json({ error: OSTA_MANAGED }, { status: 403 });
}
