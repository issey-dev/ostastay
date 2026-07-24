import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const EXCEPTION_TYPES = ["MAINTENANCE", "CLEANING", "RENOVATION", "PRIVATE_EVENT", "UNAVAILABLE"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const { id } = await params;
    const body = await request.json();
    if (!body.date || !body.exceptionType) {
      return NextResponse.json({ error: "Missing required fields (date, exceptionType)" }, { status: 400 });
    }
    if (!EXCEPTION_TYPES.includes(body.exceptionType)) {
      return NextResponse.json({ error: `exceptionType must be one of ${EXCEPTION_TYPES.join(", ")}` }, { status: 400 });
    }

    const room = await prisma.spaRoom.findUnique({ where: { id } });
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, room.propertyId, "SPA");

    const exception = await prisma.spaRoomAvailabilityException.create({
      data: {
        roomId: id,
        date: new Date(body.date),
        startTime: body.startTime || null,
        endTime: body.endTime || null,
        exceptionType: body.exceptionType,
        reason: body.reason || null,
      },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "SpaRoomAvailabilityException", entityId: exception.id,
      description: `Added ${body.exceptionType} closure for spa room "${room.name}" on ${new Date(body.date).toDateString()}`,
    });

    return NextResponse.json(exception, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
