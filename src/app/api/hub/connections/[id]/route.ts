import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { reauthorizeConnection } from "@/lib/channels/connection";
import { ChannelAuthError, ChannelApiError } from "@/lib/channels/beds24";

// Confirms the connection exists AND belongs to the caller's enterprise. One generic
// "Connection not found" either way, so a probing request cannot distinguish "belongs to
// another enterprise" from "does not exist" — the same rule assertPropertyAccess() follows.
async function assertConnectionInEnterprise(id: string, enterpriseId: string) {
  const connection = await prisma.channelConnection.findUnique({ where: { id } });
  if (!connection || connection.enterpriseId !== enterpriseId) {
    return null;
  }
  return connection;
}

// Replace the stored credentials with a fresh invite code — the recovery path when a
// refresh token has lapsed past Beds24's 30-day idle window, which cannot be repaired by
// refreshing (the token is already dead) and needs a new code from the control panel.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const existing = await assertConnectionInEnterprise(id, ctx.enterpriseId);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";
    if (!inviteCode) {
      return NextResponse.json({ error: "An invite code is required" }, { status: 400 });
    }

    const connection = await reauthorizeConnection(id, inviteCode);

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Re-authorized channel manager "${existing.name}" with a new invite code`,
      entityType: "ChannelConnection",
      entityId: id,
    });

    return NextResponse.json({ connection });
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "delete");

    const existing = await assertConnectionInEnterprise(id, ctx.enterpriseId);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await prisma.channelConnection.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "DELETE",
      description: `Removed channel manager connection "${existing.name}"`,
      entityType: "ChannelConnection",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
