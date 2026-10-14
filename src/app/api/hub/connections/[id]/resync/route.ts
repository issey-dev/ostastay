import { NextResponse } from "next/server";
import { requireSession, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { authorizeConnection } from "@/lib/channels/hub-access";
import { pollConnection, MAX_RESYNC_LOOKBACK_HOURS } from "@/lib/channels/inbound/poll";
import { convertEligibleBookings } from "@/lib/channels/inbound/convert";

// One-off deep resync from the property's own Hub: poll with an explicit lookback window,
// then convert what was recovered. The recovery path for an outage longer than the scheduled
// poll's window. Safe to repeat — ingestion is idempotent on (connectionId, externalBookingId).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    const existing = await authorizeConnection(ctx, id, "update");

    const body = await request.json().catch(() => null);
    const hours = Number(body?.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_RESYNC_LOOKBACK_HOURS) {
      return NextResponse.json(
        { error: `Lookback must be a whole number of hours between 1 and ${MAX_RESYNC_LOOKBACK_HOURS}` },
        { status: 400 }
      );
    }

    const poll = await pollConnection(id, { lookbackHours: hours });
    const converted =
      poll.status === "POLLED"
        ? (await convertEligibleBookings(existing.enterpriseId)).filter((r) => r.status === "CONVERTED").length
        : 0;

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "RUN",
      description: `Deep resync (${hours}h lookback) on "${existing.name}" — ${poll.status}: ${poll.received} received, ${poll.created} new, ${poll.updated} updated, ${converted} converted`,
      entityType: "ChannelConnection",
      entityId: id,
    });

    return NextResponse.json({ poll, converted });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
