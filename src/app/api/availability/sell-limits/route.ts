import { NextResponse } from "next/server";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { sellLimitsInWindow, setSellLimits } from "@/lib/availability-sell-limit";
import { logActivity } from "@/lib/activity-log";

// Sell limits (Agent Portal plan A-10). GET the limits in a window; POST sets or clears one
// room type's (or the house's) limit across a date range. Editing needs AVAILABILITY update
// plus the "availability.sellLimits" capability (checked in setSellLimits).
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (s: string) => new Date(`${s}T00:00:00Z`);

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "AVAILABILITY", "view");
    const url = new URL(request.url);
    const propertyId = url.searchParams.get("propertyId") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!propertyId || !DATE.test(from) || !DATE.test(to)) {
      return NextResponse.json({ error: "propertyId, from and to (yyyy-MM-dd) are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);
    return NextResponse.json(await sellLimitsInWindow(propertyId, day(from), new Date(day(to).getTime() + 86_400_000)));
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "AVAILABILITY", "update");
    const body = await request.json().catch(() => ({}));
    const propertyId = String(body?.propertyId ?? "");
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? from);
    if (!propertyId || !DATE.test(from) || !DATE.test(to)) {
      return NextResponse.json({ error: "propertyId, from and to (yyyy-MM-dd) are required" }, { status: 400 });
    }
    const extra = body?.extraRooms;
    const extraRooms = extra === null || extra === "" || extra === undefined ? null : Number(extra);
    if (extraRooms !== null && (!Number.isInteger(extraRooms) || extraRooms < 0 || extraRooms > 500)) {
      return NextResponse.json({ error: "Extra rooms must be a whole number from 0 to 500, or empty to clear" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);
    const roomTypeId = typeof body?.roomTypeId === "string" && body.roomTypeId ? body.roomTypeId : null;
    if (roomTypeId) {
      const { prisma } = await import("@/lib/db");
      const rt = await prisma.roomType.findFirst({ where: { id: roomTypeId, propertyId }, select: { id: true } });
      if (!rt) return NextResponse.json({ error: "Room type not found" }, { status: 404 });
    }
    const days = await setSellLimits(ctx, { propertyId, roomTypeId, from: day(from), to: day(to), extraRooms });
    await logActivity({
      ctx,
      module: "AVAILABILITY",
      action: "UPDATE",
      entityType: "AvailabilitySellLimit",
      entityId: propertyId,
      description:
        extraRooms === null
          ? `Cleared sell limit ${from} to ${to}${roomTypeId ? "" : " (whole house)"}`
          : `Sell limit +${extraRooms} set ${from} to ${to}${roomTypeId ? "" : " (whole house)"}`,
    });
    return NextResponse.json({ days });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
