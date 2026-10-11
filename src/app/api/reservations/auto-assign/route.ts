import { NextResponse } from "next/server";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { planAutoAssign, applyAutoAssign } from "@/lib/auto-assign";

// POST ?propertyId=...           -> the plan only (nothing is written): which room each
//                                   unassigned booking would get, and which can't be placed.
// POST ?propertyId=...&apply=1   -> body { assignments: [{ assignmentId, roomId }] } writes the
//                                   confirmed plan, re-checking every room first.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "Missing propertyId" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    if (searchParams.get("apply") !== "1") {
      return NextResponse.json(await planAutoAssign(propertyId));
    }

    const body = await request.json().catch(() => ({}));
    const picks = Array.isArray(body.assignments)
      ? body.assignments.filter((p: { assignmentId?: unknown; roomId?: unknown }) => typeof p?.assignmentId === "string" && typeof p?.roomId === "string")
      : [];
    if (picks.length === 0) return NextResponse.json({ error: "Nothing to assign." }, { status: 400 });

    const { applied, skipped } = await applyAutoAssign(propertyId, picks);
    if (applied.length > 0) {
      await logActivity({
        ctx,
        module: "RESERVATIONS",
        action: "UPDATE",
        description: `Auto-assigned rooms to ${applied.length} booking${applied.length > 1 ? "s" : ""}`,
      });
    }
    return NextResponse.json({ success: true, assignedCount: applied.length, skippedCount: skipped.length });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
