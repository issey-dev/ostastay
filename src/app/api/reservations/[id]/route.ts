import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

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
    const { id } = await params;
    const body = await request.json();
    
    // Parse and validate the body
    const data = updateSchema.parse(body);

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
    console.error("Error updating reservation:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.reservation.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting reservation:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
