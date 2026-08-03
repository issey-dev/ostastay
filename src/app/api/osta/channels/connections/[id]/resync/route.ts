import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { pollConnection, MAX_RESYNC_LOOKBACK_HOURS } from "@/lib/channels/inbound/poll";
import { convertEligibleBookings } from "@/lib/channels/inbound/convert";

// One-off deep resync: poll this connection with an explicit lookback window, then run
// the conversion sweep so recovered bookings become reservations in the same action
// rather than a job cycle later.
//
// This is the recovery path for an outage LONGER than the scheduled poll's window — the
// routine poll self-heals anything shorter, so reaching for this should be rare and
// deliberate. Nothing is persisted about the window: it applies to this one poll only.
// Safe to run with any window at any time, because ingestion is idempotent on
// (connectionId, externalBookingId) — re-reading a year costs no duplicates, only Beds24
// response size and API credits (mind the shared pool).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const hours = Number(body?.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_RESYNC_LOOKBACK_HOURS) {
      return NextResponse.json(
        { error: `Lookback must be a whole number of hours between 1 and ${MAX_RESYNC_LOOKBACK_HOURS}` },
        { status: 400 }
      );
    }

    const poll = await pollConnection(id, { lookbackHours: hours });
    // pollConnection never throws for a reachable-but-failing connection — FAILED is a
    // recorded outcome, and the operator needs the reason, so it is returned as a 200
    // exactly like the health-check route's philosophy.
    const converted =
      poll.status === "POLLED"
        ? (await convertEligibleBookings(existing.enterpriseId)).filter((r) => r.status === "CONVERTED").length
        : 0;

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "RUN",
      description: `Deep resync (${hours}h lookback) on "${existing.name}" — ${poll.status}: ${poll.received} received, ${poll.created} new, ${poll.updated} updated, ${converted} converted — by Osta platform admin`,
      entityType: "ChannelConnection",
      entityId: id,
      targetEnterpriseId: existing.enterpriseId,
    });

    return NextResponse.json({ poll, converted });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
