import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { authorizeConnection } from "@/lib/channels/hub-access";
import {
  reauthorizeConnection,
  setRateLimitPauseThreshold,
  setPollLookbackHours,
  getPropertyConnection,
} from "@/lib/channels/connection";
import { ChannelAuthError, ChannelApiError } from "@/lib/channels/beds24";

// Per-connection management from the property's own Hub. Each enterprise owns its Beds24
// account (2026-10-14), so its property admins re-authorize, correct and remove the
// connection themselves; Uppsolut keeps the same actions in the Osta console for support.
// Every handler authorises against the connection's property (hub-access.ts) — a
// property-scoped user reaches only their own, and no one reaches another enterprise's.
//
// Field-dispatched PATCH, same shape as the Osta route:
//   { inviteCode }              — replace the stored credentials (a lapsed refresh token
//                                  cannot be revived by refreshing).
//   { externalPropertyId }      — correct the Beds24 property id typed when connecting.
//   { rateLimitPauseThreshold } — self-throttle floor. The credit pool is per Beds24
//                                  ACCOUNT, so it now protects the enterprise's own pool.
//   { pollLookbackHours }       — the scheduled poll's lookback window (null = 48h default).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    const existing = await authorizeConnection(ctx, id, "update");
    const body = await request.json().catch(() => null);

    if (body && typeof body === "object" && "rateLimitPauseThreshold" in body) {
      const raw = body.rateLimitPauseThreshold;
      const threshold = raw === null ? null : Number(raw);
      if (threshold !== null && !Number.isFinite(threshold)) {
        return NextResponse.json({ error: "Pause threshold must be a number or null" }, { status: 400 });
      }
      try {
        return NextResponse.json({ connection: await setRateLimitPauseThreshold(id, threshold) });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid value" }, { status: 400 });
      }
    }

    if (body && typeof body === "object" && "pollLookbackHours" in body) {
      const raw = body.pollLookbackHours;
      const hours = raw === null ? null : Number(raw);
      if (hours !== null && !Number.isFinite(hours)) {
        return NextResponse.json({ error: "Poll lookback must be a number of hours or null" }, { status: 400 });
      }
      try {
        return NextResponse.json({ connection: await setPollLookbackHours(id, hours) });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid value" }, { status: 400 });
      }
    }

    if (body && typeof body === "object" && "externalPropertyId" in body) {
      const externalPropertyId = typeof body.externalPropertyId === "string" ? body.externalPropertyId.trim() : "";
      if (!externalPropertyId) {
        return NextResponse.json({ error: "The channel manager's property ID is required" }, { status: 400 });
      }
      try {
        await prisma.channelPropertyLink.update({ where: { propertyId: existing.propertyId }, data: { externalPropertyId } });
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && e.code === "P2002") {
          return NextResponse.json({ error: "That Beds24 property id is already linked to another property" }, { status: 409 });
        }
        throw e;
      }
      await logActivity({
        ctx,
        module: "INTEGRATIONS",
        action: "UPDATE",
        description: `Set the Beds24 property id of channel manager "${existing.name}" to ${externalPropertyId}`,
        entityType: "ChannelConnection",
        entityId: id,
      });
      return NextResponse.json({ connection: await getPropertyConnection(existing.propertyId) });
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

// Disconnect: deletes the stored credentials and (by cascade) the property's link and
// mapping. Rooms stop being shared the moment this lands, so the UI asks first.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    const existing = await authorizeConnection(ctx, id, "delete");

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
