import { NextResponse } from "next/server";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { approveSlotRequest, declineSlotRequest, SlotError } from "@/lib/groups/slot-requests";

// Approve (possibly with changes) or decline a slot request (Agent Portal plan A-7).
//   { action: "approve", startDate?, endDate?, rooms?: [{roomTypeId, quantity}], note?,
//     rules?: { cutoffDate?, releaseDays?, elasticRooms?, elasticNightsBefore?, elasticNightsAfter?,
//               checkpoints?: [{ date, minPercent }] } }
//   { action: "decline", reason }
// Needs GROUP_BLOCKS update and the "Approve or decline a slot request" capability.
const toDate = (v: unknown) => (typeof v === "string" && v ? new Date(v) : undefined);
const toInt = (v: unknown) => (v === null || v === "" || v === undefined ? undefined : Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : undefined);

type CheckpointIn = { date?: string; minPercent?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "GROUP_BLOCKS", "update");
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body?.action === "decline") return NextResponse.json(await declineSlotRequest(ctx, id, String(body.reason ?? "")));
    if (body?.action !== "approve") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const r = body.rules ?? {};
    const checkpoints = Array.isArray(r.checkpoints)
      ? (r.checkpoints as CheckpointIn[])
          .map((c) => ({ date: toDate(c?.date), minPercent: Number(c?.minPercent) }))
          .filter((c): c is { date: Date; minPercent: number } => !!c.date && c.minPercent > 0 && c.minPercent <= 100)
      : undefined;
    const result = await approveSlotRequest(ctx, id, {
      startDate: toDate(body.startDate),
      endDate: toDate(body.endDate),
      rooms: body.rooms,
      note: typeof body.note === "string" ? body.note : null,
      rules: {
        ...(r.cutoffDate !== undefined ? { cutoffDate: toDate(r.cutoffDate) ?? null } : {}),
        ...(r.releaseDays !== undefined ? { releaseDays: toInt(r.releaseDays) ?? null } : {}),
        ...(toInt(r.elasticRooms) !== undefined ? { elasticRooms: toInt(r.elasticRooms) } : {}),
        ...(toInt(r.elasticNightsBefore) !== undefined ? { elasticNightsBefore: toInt(r.elasticNightsBefore) } : {}),
        ...(toInt(r.elasticNightsAfter) !== undefined ? { elasticNightsAfter: toInt(r.elasticNightsAfter) } : {}),
        ...(checkpoints ? { checkpoints } : {}),
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SlotError) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
