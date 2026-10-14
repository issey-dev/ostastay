import { NextResponse } from "next/server";
import { requireSession, requirePropertySetup, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { authorizePropertyParam } from "@/lib/channels/hub-access";
import { getPropertyConnection, createConnection } from "@/lib/channels/connection";
import { ChannelAuthError, ChannelApiError } from "@/lib/channels/beds24";

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

// Connect a property to the enterprise's OWN Beds24 account. Since 2026-10-14 each
// enterprise holds its own channel-manager account and connects its properties itself: the
// invite code comes from the enterprise's Beds24 account, so the property team is the one
// holding it. Uppsolut can still connect a property on a customer's behalf from the Osta
// console (src/app/api/osta/channels/connections) — both paths end in createConnection(),
// which re-checks the property, the one-connection rule and the license cap BEFORE the
// single-use invite code is spent.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json().catch(() => null);
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
    const externalPropertyId = typeof body?.externalPropertyId === "string" ? body.externalPropertyId.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";

    if (!propertyId) return NextResponse.json({ error: "A property is required" }, { status: 400 });
    // Ownership + own-property + INTEGRATIONS create, before anything else is looked at.
    await requirePropertySetup(ctx, propertyId, "INTEGRATIONS", "create");

    if (!externalPropertyId) {
      return NextResponse.json({ error: "The channel manager's property ID is required" }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "A connection name is required" }, { status: 400 });
    if (!inviteCode) return NextResponse.json({ error: "An invite code is required" }, { status: 400 });

    const connection = await createConnection({ propertyId, externalPropertyId, name, inviteCode });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "CREATE",
      description: `Connected channel manager "${name}" (Beds24 property ${externalPropertyId})`,
      entityType: "ChannelConnection",
      entityId: connection.id,
    });

    return NextResponse.json({ connection }, { status: 201 });
  } catch (error) {
    if (error instanceof ChannelAuthError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ChannelApiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
