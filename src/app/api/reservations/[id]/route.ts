import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { materializeReservationAllocations } from "@/lib/allocations-server";

const updateSchema = z.object({
  primaryGuestId: z.string().min(1),
  // Multi-segment (split-stay) assignments — mirrors POST's shape. The reservation form
  // has supported multiple room segments per stay for a while; this schema previously
  // still required single top-level roomTypeId/ratePlanId fields the form never sent,
  // which made every edit through the UI 400.
  assignments: z.array(z.object({
    roomTypeId: z.string().min(1),
    roomId: z.string().optional().nullable(),
    ratePlanId: z.string().min(1),
    overrideRate: z.number().optional().nullable(),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  })).min(1),
  checkInDate: z.string().min(1),
  checkOutDate: z.string().min(1),
  adults: z.number().or(z.string().transform(v => parseInt(v))),
  children: z.number().or(z.string().transform(v => parseInt(v))),
  infants: z.number().or(z.string().transform(v => parseInt(v))).optional(),
  mealPlan: z.string().optional(),
  remarks: z.string().optional().nullable(),
  travelAgentId: z.string().optional().nullable(),
  accompanyingGuestIds: z.array(z.string()).optional(),
  manualAllocationIds: z.array(z.string()).optional(),
  status: z.string().min(1)
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;
    const existing = await prisma.reservation.findUnique({
      where: { id },
      include: { assignments: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    const body = await request.json();

    // Parse and validate the body
    const data = updateSchema.parse(body);

    const primaryGuest = await prisma.profile.findUnique({ where: { upid: data.primaryGuestId } });
    if (!primaryGuest || primaryGuest.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Guest profile not found" }, { status: 404 });
    }
    if (data.travelAgentId) {
      const travelAgent = await prisma.profile.findUnique({ where: { upid: data.travelAgentId } });
      if (!travelAgent || travelAgent.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Travel agent profile not found" }, { status: 404 });
      }
    }
    if (data.accompanyingGuestIds && data.accompanyingGuestIds.length > 0) {
      const accompanying = await prisma.profile.findMany({ where: { upid: { in: data.accompanyingGuestIds } } });
      if (accompanying.length !== data.accompanyingGuestIds.length || accompanying.some((p) => p.enterpriseId !== ctx.enterpriseId)) {
        return NextResponse.json({ error: "One or more accompanying guest profiles were not found" }, { status: 404 });
      }
    }

    // Only enforced for a room type/room not already on this reservation — a segment
    // already sitting in a room whose type has since been deactivated can still be
    // edited (dates, other segments, etc.) without being blocked by that.
    for (const a of data.assignments) {
      const [roomType, ratePlan, room] = await Promise.all([
        prisma.roomType.findUnique({ where: { id: a.roomTypeId } }),
        prisma.ratePlan.findUnique({ where: { id: a.ratePlanId } }),
        a.roomId ? prisma.room.findUnique({ where: { id: a.roomId } }) : Promise.resolve(null),
      ]);
      if (!roomType || roomType.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 });
      }
      const isExistingRoomType = existing.assignments.some((ex) => ex.roomTypeId === a.roomTypeId);
      if (!isExistingRoomType && !roomType.isActive) {
        return NextResponse.json({ error: "This room type is inactive and cannot accept new reservations" }, { status: 400 });
      }
      if (!ratePlan || ratePlan.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Rate plan does not belong to this property" }, { status: 400 });
      }
      if (a.roomId && (!room || room.propertyId !== existing.propertyId)) {
        return NextResponse.json({ error: "Room does not belong to this property" }, { status: 400 });
      }
      const isExistingRoom = existing.assignments.some((ex) => ex.roomId === a.roomId);
      if (a.roomId && !isExistingRoom && room?.status === "OUT_OF_SERVICE") {
        return NextResponse.json({ error: "That room is out of service" }, { status: 400 });
      }
    }

    const updatedReservation = await prisma.reservation.update({
      where: { id },
      data: {
        primaryGuestId: data.primaryGuestId,
        checkInDate: new Date(data.checkInDate),
        checkOutDate: new Date(data.checkOutDate),
        adults: data.adults,
        children: data.children,
        ...(data.infants !== undefined && { infants: data.infants }),
        mealPlan: data.mealPlan,
        ...(data.remarks !== undefined && { remarks: data.remarks }),
        travelAgentId: data.travelAgentId,
        status: data.status,
        assignments: {
          deleteMany: {},
          create: data.assignments.map((a) => ({
            roomTypeId: a.roomTypeId,
            roomId: a.roomId || null,
            ratePlanId: a.ratePlanId,
            overrideRate: a.overrideRate ?? null,
            startDate: new Date(a.startDate),
            endDate: new Date(a.endDate),
          }))
        },
        ...(data.accompanyingGuestIds !== undefined && {
          accompanyingGuests: {
            deleteMany: {},
            create: data.accompanyingGuestIds.map((id: string) => ({ profileId: id }))
          }
        })
      },
      include: {
        primaryGuest: true,
        travelAgent: true,
        accompanyingGuests: { include: { profile: true } },
        assignments: {
          include: { roomType: true, room: true, ratePlan: true }
        },
      }
    });

    // Re-derive rate-plan/meal-plan allocation rows against the edited values; MANUAL
    // rows are replaced only when the client sent manualAllocationIds, otherwise kept.
    const allocationResult = await materializeReservationAllocations({
      reservationId: id,
      propertyId: existing.propertyId,
      ratePlanId: data.assignments[0]?.ratePlanId ?? null,
      mealPlanCode: data.mealPlan || "NONE",
      manualAllocationIds: data.manualAllocationIds,
    });
    if (allocationResult.error) {
      return NextResponse.json({ ...updatedReservation, allocationWarning: allocationResult.error });
    }

    return NextResponse.json(updatedReservation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "delete");

    const { id } = await params;
    const existing = await prisma.reservation.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    await prisma.reservation.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
