import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { listAllConnections, createConnection } from "@/lib/channels/connection";
import { ChannelAuthError, ChannelApiError } from "@/lib/channels/beds24";

// Platform-side channel-manager administration — the Osta console counterpart of
// /api/hub/connections. Exists for the master-account topology decision
// (.agents/docs/DECISIONS.md, 2026-08-02): the app owner runs ONE Beds24 account, creates
// the properties in it, and drives each customer enterprise's initial setup from the Osta
// console — so these routes deliberately reach across tenants. That reach is exactly why
// every handler demands ctx.isInternal before anything else; the tenant-facing routes
// scope to ctx.enterpriseId instead and no tenant ever comes through here.
//
// Guarded on INTEGRATIONS rather than the CONTROLS bit the other /api/osta routes use:
// this is channel-manager work, and the permission should say so. Osta system roles carry
// FULL on every module, so nothing existing changes hands.
//
// Same credential posture as the Hub: tokens are write-only from the browser's point of
// view — listAllConnections() goes through toPublicConnection, which has no token fields.

export async function GET() {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage connections across enterprises");
    }
    requirePermission(ctx, "INTEGRATIONS", "view");

    return NextResponse.json({ connections: await listAllConnections() });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

// Create a connection FOR one customer property (one connection per property — owner,
// 2026-09-23). The invite code comes from the app owner's own master Beds24 account, so the
// operator holding it is the Osta admin, never the tenant; the property's Beds24 property id
// is linked in the same step, and the property's own Hub area takes it from there (mapping,
// checks, bookings, logs).
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage connections across enterprises");
    }
    requirePermission(ctx, "INTEGRATIONS", "create");

    const body = await request.json().catch(() => null);
    const propertyId = typeof body?.propertyId === "string" ? body.propertyId : "";
    const externalPropertyId = typeof body?.externalPropertyId === "string" ? body.externalPropertyId.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";

    if (!propertyId) {
      return NextResponse.json({ error: "A property is required" }, { status: 400 });
    }
    if (!externalPropertyId) {
      return NextResponse.json({ error: "The channel manager's property ID is required" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "A connection name is required" }, { status: 400 });
    }
    if (!inviteCode) {
      return NextResponse.json({ error: "An invite code is required" }, { status: 400 });
    }

    // STANDARD only — a connection on the INTERNAL (Osta) enterprise could only be a
    // mistake. Same rule as support-access grants; createConnection re-checks it.
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { name: true, enterpriseId: true, enterprise: { select: { type: true } } },
    });
    if (!property || property.enterprise.type !== "STANDARD") {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }
    const enterpriseId = property.enterpriseId;

    const connection = await createConnection({ propertyId, externalPropertyId, name, inviteCode });

    // Logged into the TENANT's trail — the enterprise whose channel manager was just
    // wired up is the one whose auditors need to see it. logActivity snapshots the Osta
    // admin's identity onto the row, so who did it stays visible there.
    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "CREATE",
      description: `Connected channel manager "${name}" (Beds24) for ${property.name} — set up by Osta platform admin`,
      entityType: "ChannelConnection",
      entityId: connection.id,
      targetEnterpriseId: enterpriseId,
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
