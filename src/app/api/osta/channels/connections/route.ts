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

// Create a connection FOR a customer enterprise. The invite code comes from the app
// owner's own master Beds24 account (scoped there to just this customer's properties),
// so the operator holding it is the Osta admin, not the tenant.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage connections across enterprises");
    }
    requirePermission(ctx, "INTEGRATIONS", "create");

    const body = await request.json().catch(() => null);
    const enterpriseId = typeof body?.enterpriseId === "string" ? body.enterpriseId : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";

    if (!enterpriseId) {
      return NextResponse.json({ error: "An enterprise is required" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "A connection name is required" }, { status: 400 });
    }
    if (!inviteCode) {
      return NextResponse.json({ error: "An invite code is required" }, { status: 400 });
    }

    // STANDARD only — a connection on the INTERNAL (Osta) enterprise would be a channel
    // manager wired to an enterprise with no operational properties, which can only be a
    // mistake. Same rule as support-access grants.
    const enterprise = await prisma.enterprise.findUnique({ where: { id: enterpriseId } });
    if (!enterprise || enterprise.type !== "STANDARD") {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }

    const connection = await createConnection({ enterpriseId, name, inviteCode });

    // Logged into the TENANT's trail — the enterprise whose channel manager was just
    // wired up is the one whose auditors need to see it. logActivity snapshots the Osta
    // admin's identity onto the row, so who did it stays visible there.
    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "CREATE",
      description: `Connected channel manager "${name}" (Beds24) — set up by Osta platform admin`,
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
