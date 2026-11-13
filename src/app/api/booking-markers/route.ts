import { NextResponse } from "next/server";
import { requireSession, requirePermission, requirePropertySetup, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { getMarkerRules, parseMarkerRules, saveMarkerRules } from "@/lib/booking-markers-server";
import { logActivity } from "@/lib/activity-log";

// Booking marker rules (Agent Portal plan A-22). GET is read by the Tape Chart and lists
// (TAPE_CHART or RESERVATIONS view); PUT replaces the property's ordered list from the Hub
// (property area, CONTROLS update).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = new URL(request.url).searchParams.get("propertyId") ?? "";
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);
    try {
      requirePermission(ctx, "TAPE_CHART", "view");
    } catch {
      requirePermission(ctx, "RESERVATIONS", "view");
    }
    return NextResponse.json(await getMarkerRules(propertyId));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json().catch(() => ({}));
    const propertyId = String(body?.propertyId ?? "");
    await requirePropertySetup(ctx, propertyId, "CONTROLS", "update");
    const rules = parseMarkerRules(body?.rules);
    if (typeof rules === "string") return NextResponse.json({ error: rules }, { status: 400 });
    await saveMarkerRules(propertyId, rules);
    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "BookingMarker",
      entityId: propertyId,
      description: `Booking markers saved (${rules.length} rule${rules.length === 1 ? "" : "s"})`,
    });
    return NextResponse.json(await getMarkerRules(propertyId));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
