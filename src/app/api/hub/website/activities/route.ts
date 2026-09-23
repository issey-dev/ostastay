import { NextResponse } from "next/server";
import { requireSession, requireHubAccess, requirePermission, toErrorResponse } from "@/lib/scope";
import { listActivitySettings } from "@/lib/website-api/activity-settings";

// What each property sells online for Excursions and Spa through the Booking API — see
// src/lib/website-api/activity-settings.ts and BOOKING_API_ADDONS_PLAN.md Phase 1. Same
// gates as the rest of Hub → Booking API: Hub access + INTEGRATIONS.
export async function GET() {
  try {
    const ctx = await requireSession();
    requireHubAccess(ctx);
    requirePermission(ctx, "INTEGRATIONS", "view");
    return NextResponse.json(await listActivitySettings(ctx.enterpriseId));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
