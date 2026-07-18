import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

const updateSchema = z.object({
  primaryGuestId: z.string().min(1),
  roomTypeId: z.string().min(1),
  ratePlanId: z.string().min(1),
  roomId: z.string().optional().nullable(),
  checkInDate: z.string().min(1),
  checkOutDate: z.string().min(1),
  adults: z.number().or(z.string().transform(v => parseInt(v))),
  children: z.number().or(z.string().transform(v => parseInt(v))),
  mealPlan: z.string().optional(),
  travelAgentId: z.string().optional().nullable(),
  accompanyingGuestIds: z.array(z.string()).optional(),
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
    const existing = await prisma.reservation.findUnique({ where: { id } });
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

    const [roomType, ratePlan, room] = await Promise.all([
      prisma.roomType.findUnique({ where: { id: data.roomTypeId } }),
      prisma.ratePlan.findUnique({ where: { id: data.ratePlanId } }),
      data.roomId ? prisma.room.findUnique({ where: { id: data.roomId } }) : Promise.resolve(null),
    ]);
    if (!roomType || roomType.propertyId !== existing.propertyId) {
      return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 });
    }
    if (!ratePlan || ratePlan.propertyId !== existing.propertyId) {
      return NextResponse.json({ error: "Rate plan does not belong to this property" }, { status: 400 });
    }
    if (data.roomId && (!room || room.propertyId !== existing.propertyId)) {
      return NextResponse.json({ error: "Room does not belong to this property" }, { status: 400 });
    }

    const updatedReservation = await prisma.reservation.update({
      where: { id },
      data: {
        primaryGuestId: data.primaryGuestId,
        checkInDate: new Date(data.checkInDate),
        checkOutDate: new Date(data.checkOutDate),
        adults: data.adults,
        children: data.children,
        mealPlan: data.mealPlan,
        travelAgentId: data.travelAgentId,
        status: data.status,
        assignments: {
          deleteMany: {},
          create: [{
            roomTypeId: data.roomTypeId,
            roomId: data.roomId || null,
            ratePlanId: data.ratePlanId,
            startDate: new Date(data.checkInDate),
            endDate: new Date(data.checkOutDate)
          }]
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
