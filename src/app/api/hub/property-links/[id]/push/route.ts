import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { pushAvailabilityForLink } from "@/lib/channels/push";

// Push availability for one link, on demand.
//
// Two modes, and the difference matters:
//   ?dryRun=1  — computes and returns the exact body that WOULD be sent, sending nothing.
//                Allowed on "view", and allowed while sharing is off, because inspecting a
//                payload before it reaches an OTA is precisely the point.
//   (default)  — really sends. Requires "update", and pushAvailabilityForLink refuses
//                unless the operator has turned sharing on for that property.
//
// A real push is recorded in the activity log as well as the exchange log: the exchange log
// says what was sent, the activity log says WHO chose to send it outside the schedule.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "1";

    requirePermission(ctx, "INTEGRATIONS", dryRun ? "view" : "update");

    const result = await pushAvailabilityForLink({ enterpriseId: ctx.enterpriseId, linkId: id, dryRun });

    if (!dryRun && result.status === "PUSHED") {
      await logActivity({
        ctx,
        module: "INTEGRATIONS",
        action: "UPDATE",
        description: `Pushed availability for "${result.propertyName}" (${result.roomTypeCount} room type(s), ${result.nightCount} nights)`,
        entityType: "ChannelPropertyLink",
        entityId: id,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
