import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");

    if (!propertyId || !startDateStr || !endDateStr) {
      return NextResponse.json({ error: "Missing required parameters (propertyId, startDate, endDate)" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    // 1. Fetch all rooms for the property, grouped by room type
    const rooms = await prisma.room.findMany({
      where: { propertyId },
      include: {
        roomType: true,
      },
      orderBy: [
        { roomType: { name: 'asc' } },
        { roomNumber: 'asc' }
      ]
    });

    // 2. Fetch all RoomAssignments that overlap with this date range
    // Overlap condition: assignment.startDate <= endDate AND assignment.endDate >= startDate
    const assignments = await prisma.roomAssignment.findMany({
      where: {
        reservation: { propertyId },
        startDate: { lte: endDate },
        endDate: { gte: startDate }
      },
      include: {
        reservation: {
          include: {
            primaryGuest: true
          }
        },
        roomType: true,
        room: true
      }
    });

    return NextResponse.json({
      rooms,
      assignments
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
