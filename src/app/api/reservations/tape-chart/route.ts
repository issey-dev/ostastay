import { NextResponse } from "next/server";
import { expireOptionsSoon } from "@/lib/reservations/options";
import { figuresJson } from "@/lib/figures";
import { prisma } from "@/lib/db";
import { getMarkerRules } from "@/lib/booking-markers-server";
import { addDays, parseISO, startOfDay, endOfDay } from "date-fns";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "TAPE_CHART", "view");
    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get('startDate');
    const daysParam = searchParams.get('days') || '14';
    const propertyId = searchParams.get('propertyId');

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);
    await expireOptionsSoon(propertyId);

    // Default to today if not provided
    const startDate = startDateParam ? startOfDay(parseISO(startDateParam)) : startOfDay(new Date());
    const days = parseInt(daysParam, 10);
    const endDate = endOfDay(addDays(startDate, days));

    // Fetch all active rooms grouped by floor for this property. Pseudo/virtual rooms
    // have no floor at all, so they never belong on a physical tape chart.
    const rooms = await prisma.room.findMany({
      where: {
        propertyId,
        status: { not: "OUT_OF_SERVICE" },
        floorId: { not: null }
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
            primaryGuest: true,
            // Booking markers (Agent Portal plan A-22): who it came from.
            sourceProfile: { select: { upid: true, companyName: true, firstName: true, markerIcon: true, markerColor: true } },
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
        lastName: a.reservation.primaryGuest.lastName || "",
        vipLevel: a.reservation.primaryGuest.vipLevel
      },
      roomType: {
        code: a.roomType.code,
        name: a.roomType.name
      },
      reservationCheckInDate: a.reservation.checkInDate.toISOString(),
      reservationCheckOutDate: a.reservation.checkOutDate.toISOString(),
      // The facts the markers read (src/lib/booking-markers.ts), resolved on the client so
      // the legend and filters see the same thing.
      markerFacts: {
        status: a.reservation.status,
        origin: a.reservation.origin,
        isOverflow: a.reservation.isOverflow,
        confirmationRequestedAt: a.reservation.confirmationRequestedAt,
        groupBlockId: a.reservation.groupBlockId,
        travelAgentId: a.reservation.travelAgentId,
        vipLevel: a.reservation.primaryGuest.vipLevel,
        source: a.reservation.sourceProfile
          ? {
              upid: a.reservation.sourceProfile.upid,
              name: a.reservation.sourceProfile.companyName || a.reservation.sourceProfile.firstName,
              markerIcon: a.reservation.sourceProfile.markerIcon,
              markerColor: a.reservation.sourceProfile.markerColor,
            }
          : null,
      },
      optionDate: a.reservation.optionDate?.toISOString() ?? null,
    }));

    return figuresJson(ctx, {
      success: true,
      data: {
        startDate,
        endDate,
        days,
        rooms,
        reservations: formattedReservations,
        markerRules: await getMarkerRules(propertyId),
      }
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
