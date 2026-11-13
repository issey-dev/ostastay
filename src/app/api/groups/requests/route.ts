import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { createSlotRequest, SlotError } from "@/lib/groups/slot-requests";
import { logActivity } from "@/lib/activity-log";

// Slot requests (Agent Portal plan A-7): the Group Blocks "Requests" tab. GET lists the
// property's pending requests plus the last 30 days' decisions; POST records one on behalf
// of a Source (the Agent API creates them too). A request holds nothing.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "GROUP_BLOCKS", "view");
    const propertyId = new URL(request.url).searchParams.get("propertyId") ?? "";
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await prisma.groupBlock.findMany({
      where: {
        propertyId,
        OR: [{ status: "REQUESTED" }, { sourceProfileId: { not: null }, decidedAt: { gte: since } }],
      },
      include: {
        roomHolds: { include: { roomType: { select: { id: true, code: true, name: true, isPseudo: true } } } },
        sourceProfile: { select: { upid: true, companyName: true, firstName: true, markerColor: true, markerIcon: true } },
      },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(rows);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "GROUP_BLOCKS", "create");
    const body = await request.json().catch(() => ({}));
    const propertyId = String(body?.propertyId ?? "");
    await assertPropertyAccess(ctx, propertyId);
    const block = await createSlotRequest({
      enterpriseId: ctx.enterpriseId,
      propertyId,
      sourceProfileId: String(body?.sourceProfileId ?? ""),
      startDate: new Date(String(body?.startDate ?? "")),
      endDate: new Date(String(body?.endDate ?? "")),
      rooms: body?.rooms,
      note: body?.note,
      isOverflow: body?.isOverflow === true,
      origin: "DESK",
    });
    await logActivity({ ctx, module: "GROUP_BLOCKS", action: "CREATE", entityType: "GroupBlock", entityId: block.id, description: `Recorded slot request ${block.code}` });
    return NextResponse.json(block, { status: 201 });
  } catch (error) {
    if (error instanceof SlotError) return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
