import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; exceptionId: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id, exceptionId } = await params;
    const exception = await prisma.spaRoomAvailabilityException.findUnique({
      where: { id: exceptionId },
      include: { room: true },
    });
    if (!exception || exception.roomId !== id) {
      return NextResponse.json({ error: "Exception not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, exception.room.propertyId, "SPA");

    await prisma.spaRoomAvailabilityException.delete({ where: { id: exceptionId } });

    await logActivity({
      ctx, module: "CONTROLS", action: "DELETE", entityType: "SpaRoomAvailabilityException", entityId: exceptionId,
      description: `Removed ${exception.exceptionType} closure for spa room "${exception.room.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
