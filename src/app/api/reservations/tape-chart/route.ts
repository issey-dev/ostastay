import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addDays, parseISO, startOfDay, endOfDay } from "date-fns";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get('startDate');
    const daysParam = searchParams.get('days') || '14';
    const propertyId = searchParams.get('propertyId') || '00000000-0000-0000-0000-000000000000';
    
    // Default to today if not provided
    const startDate = startDateParam ? startOfDay(parseISO(startDateParam)) : startOfDay(new Date());
    const days = parseInt(daysParam, 10);
    const endDate = endOfDay(addDays(startDate, days));

    // Fetch all active rooms grouped by floor for this property
    const rooms = await prisma.room.findMany({
      where: {
        propertyId,
        status: { not: "OUT_OF_SERVICE" }
      },
      include: {
        floor: true,
        roomType: true
      },
      orderBy: [
        { floor: { name: 'asc' } },
        { roomNumber: 'asc' }
      ]
    });

    // Fetch RoomAssignments that overlap with this date window
    // An overlap occurs if assignment.startDate <= endDate AND assignment.endDate >= startDate
    const assignments = await prisma.roomAssignment.findMany({
      where: {
        reservation: {
          propertyId,
          status: { not: "CANCELLED" }
        },
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

    // Format assignments to look like reservations for the frontend tape-chart grid
    const formattedReservations = assignments.map(a => ({
      id: a.id, // Unique ID for this block on the chart (the assignment ID)
      reservationId: a.reservationId, // Reference to parent reservation
      confirmationNo: a.reservation.confirmationNo,
      roomId: a.roomId,
      checkInDate: a.startDate.toISOString(),
      checkOutDate: a.endDate.toISOString(),
      status: a.reservation.status,
      primaryGuest: {
        firstName: a.reservation.primaryGuest.firstName,
        lastName: a.reservation.primaryGuest.lastName || ""
      },
      roomType: {
        code: a.roomType.code,
        name: a.roomType.name
      },
      reservationCheckInDate: a.reservation.checkInDate.toISOString(),
      reservationCheckOutDate: a.reservation.checkOutDate.toISOString()
    }));

    return NextResponse.json({
      success: true,
      data: {
        startDate,
        endDate,
        days,
        rooms,
        reservations: formattedReservations
      }
    });
  } catch (error) {
    console.error("Tape Chart Error:", error);
    return NextResponse.json({ error: "Failed to fetch tape chart data" }, { status: 500 });
  }
}

