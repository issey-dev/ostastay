import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { getBookingDefaults, setBookingDefaults } from "@/lib/channels/defaults";

// Per-link defaults for converting an inbound channel booking into a Reservation — see
// src/lib/channels/defaults.ts. The Hub's Mapping > Defaults tab is the only UI for this.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");

    const defaults = await getBookingDefaults(ctx.enterpriseId, id);
    return NextResponse.json(defaults);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "update");

    const body = await request.json().catch(() => null);
    const ratePlanId = typeof body?.ratePlanId === "string" && body.ratePlanId.trim() ? body.ratePlanId : null;
    const mealPlanCode = typeof body?.mealPlanCode === "string" ? body.mealPlanCode : "NONE";

    const defaults = await setBookingDefaults({ enterpriseId: ctx.enterpriseId, linkId: id, ratePlanId, mealPlanCode });

    await logActivity({
      ctx,
      module: "INTEGRATIONS",
      action: "UPDATE",
      description: "Updated channel-booking conversion defaults for a property",
      entityType: "ChannelPropertyLink",
      entityId: id,
    });

    return NextResponse.json(defaults);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
