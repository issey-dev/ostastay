import { NextResponse } from "next/server";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { authorizePropertyParam } from "@/lib/channels/hub-access";
import { getPropertyConnection } from "@/lib/channels/connection";

// A property's channel-manager connection (one per property) — see
// .agents/docs/HUB_CHANNEL_MANAGER_PLAN.md and src/lib/channels/hub-access.ts. ?propertyId=
// is required; the caller needs Property Setup (INTEGRATIONS) there.

// A stored channel-manager credential can move real inventory and accept real bookings.
// It is therefore WRITE-ONLY from the browser's point of view: nothing here ever returns a
// token, and there is deliberately no endpoint that reveals one.

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = await authorizePropertyParam(ctx, request, "view");

    return NextResponse.json({ connection: await getPropertyConnection(propertyId) });
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
  "Channel-manager connections are set up by Uppsolut. Contact Uppsolut to connect a property's channel manager.";

export async function POST() {
  return NextResponse.json({ error: OSTA_MANAGED }, { status: 403 });
}
