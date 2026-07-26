import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { minTypeAvailability } from "@/lib/availability";

// Per-room-type "max holdable" for a date range — the most a group block can hold
// without overbooking (capacity − bookings − OTHER blocks' holds, min across nights).
// excludeGroupBlockId omits the block currently being edited so its own holds don't
// count against it. Read-only.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "GROUP_BLOCKS", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const excludeGroupBlockId = searchParams.get("excludeGroupBlockId");
    if (!propertyId || !startDate || !endDate) {
      return NextResponse.json({ error: "propertyId, startDate and endDate are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const types = await prisma.roomType.findMany({ where: { propertyId, isPseudo: false }, select: { id: true } });
    const available: Record<string, number> = {};
    for (const t of types) {
      available[t.id] = await minTypeAvailability({ propertyId, roomTypeId: t.id, startDate: start, endDate: end, excludeGroupBlockId });
    }
    return NextResponse.json({ available });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
