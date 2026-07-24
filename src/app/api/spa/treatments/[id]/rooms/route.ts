import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Full replacement of a treatment's compatible-room set — same "whole set" convention
// as skills/schedule. The booking engine's room-candidate list (SPA_PLAN.md §7) reads
// SpaTreatmentRoom directly (falling back to a roomType match when no rows exist for
// a treatment), so this is the single place that list is edited.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();
    if (!Array.isArray(body.rooms)) {
      return NextResponse.json({ error: "rooms must be an array" }, { status: 400 });
    }

    const treatment = await prisma.spaTreatment.findUnique({ where: { id } });
    if (!treatment) {
      return NextResponse.json({ error: "Treatment not found" }, { status: 404 });
    }
    await assertPropertyModuleAccess(ctx, treatment.propertyId, "SPA");

    const roomIds: string[] = body.rooms.map((r: { roomId?: string }) => r.roomId).filter(Boolean);
    if (roomIds.length > 0) {
      const validRooms = await prisma.spaRoom.count({
        where: { id: { in: roomIds }, propertyId: treatment.propertyId },
      });
      if (validRooms !== new Set(roomIds).size) {
        return NextResponse.json({ error: "One or more rooms do not belong to this property" }, { status: 400 });
      }
    }

    await prisma.$transaction([
      prisma.spaTreatmentRoom.deleteMany({ where: { treatmentId: id } }),
      prisma.spaTreatmentRoom.createMany({
        data: body.rooms.map((r: { roomId: string; preferred?: boolean }) => ({
          treatmentId: id,
          roomId: r.roomId,
          preferred: r.preferred !== undefined ? !!r.preferred : false,
        })),
      }),
    ]);

    const updated = await prisma.spaTreatment.findUnique({
      where: { id },
      include: { compatibleRooms: { include: { room: { select: { id: true, name: true } } } } },
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "UPDATE", entityType: "SpaTreatment", entityId: id,
      description: `Updated compatible rooms for spa treatment "${treatment.name}"`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
