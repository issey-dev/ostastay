import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { reauthorizeConnection, setRateLimitPauseThreshold, setPollLookbackHours } from "@/lib/channels/connection";
import { ChannelAuthError, ChannelApiError } from "@/lib/channels/beds24";

// Osta-console per-connection management — see ../route.ts for why this reaches across
// tenants and why it is guarded on isInternal + INTEGRATIONS.
//
// No enterprise scoping on the lookup, ON PURPOSE: cross-tenant reach is this API's job.
// The internal guard is the entire access control, which is why it comes first in every
// handler and why these routes must never be reachable through any tenant-facing path.

// Same field-dispatched PATCH as the Hub route:
//   { inviteCode }               — replace the stored credentials (recovery for a lapsed
//                                   refresh token; refreshing cannot revive a dead one).
//   { rateLimitPauseThreshold }  — the self-throttle floor. Under the master-account
//                                   topology every tenant drains ONE shared Beds24 credit
//                                   pool, so setting these floors is how the platform
//                                   stops one busy property starving the rest.
//   { pollLookbackHours }        — the scheduled poll's lookback window (null = default
//                                   48h). This is the outage self-heal horizon; one-off
//                                   catch-ups beyond it belong to [id]/resync.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage connections across enterprises");
    }
    requirePermission(ctx, "INTEGRATIONS", "update");

    const existing = await prisma.channelConnection.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);

    if (body && typeof body === "object" && "rateLimitPauseThreshold" in body) {
      const raw = body.rateLimitPauseThreshold;
      const threshold = raw === null ? null : Number(raw);
      if (threshold !== null && !Number.isFinite(threshold)) {
        return NextResponse.json({ error: "Pause threshold must be a number or null" }, { status: 400 });
      }
      const connection = await setRateLimitPauseThreshold(id, threshold);
      return NextResponse.json({ connection });
    }

    if (body && typeof body === "object" && "pollLookbackHours" in body) {
      const raw = body.pollLookbackHours;
      const hours = raw === null ? null : Number(raw);
      if (hours !== null && !Number.isFinite(hours)) {
        return NextResponse.json({ error: "Poll lookback must be a number of hours or null" }, { status: 400 });
      }
      try {
        const connection = await setPollLookbackHours(id, hours);
        return NextResponse.json({ connection });
      } catch (e) {
        // The setter's own bounds message (1..MAX_STORED_LOOKBACK_HOURS) is the useful one.
        return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid value" }, { status: 400 });
      }
    }

    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";
    if (!inviteCode) {
      return NextResponse.json({ error: "An invite code is required" }, { status: 400 });
    }

    const connection = await reauthorizeConnection(id, inviteCode);

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: `Re-authorized channel manager "${existing.name}" with a new invite code — by Osta platform admin`,
      entityType: "ChannelConnection",
      entityId: id,
      targetEnterpriseId: existing.enterpriseId,
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
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage connections across enterprises");
    }
    requirePermission(ctx, "INTEGRATIONS", "delete");

    const existing = await prisma.channelConnection.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    await prisma.channelConnection.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "DELETE",
      description: `Removed channel manager connection "${existing.name}" — by Osta platform admin`,
      entityType: "ChannelConnection",
      entityId: id,
      targetEnterpriseId: existing.enterpriseId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
