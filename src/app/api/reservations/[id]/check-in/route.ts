import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "RESERVATIONS", "update");

    const { id } = await params;

    // 1. Fetch reservation
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        assignments: { include: { room: true }, orderBy: { startDate: 'desc' } },
        folios: true
      }
    });

    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, reservation.propertyId);

    if (reservation.status === "IN_HOUSE") {
      return NextResponse.json({ error: "Guest is already checked in" }, { status: 400 });
    }

    if (reservation.status === "CANCELLED" || reservation.status === "CHECKED_OUT") {
      return NextResponse.json({ error: "Cannot check in a cancelled or already checked out reservation" }, { status: 400 });
    }

    const activeAssignment = reservation.assignments[0];
    if (!activeAssignment?.roomId) {
      return NextResponse.json({ error: "A room must be assigned before checking in" }, { status: 400 });
    }

    // Room readiness: never check a guest into a room that's out of order/service.
    // A DIRTY room doesn't block (housekeeping status can lag reality and front desk
    // may knowingly proceed) but the response carries a warning to surface — unless
    // the property has turned on the inspection gate, in which case anything short
    // of INSPECTED blocks outright (supervisor sign-off required before arrival).
    const assignedRoom = activeAssignment.room;
    let roomWarning: string | undefined;
    if (assignedRoom) {
      if (assignedRoom.status === "OUT_OF_ORDER" || assignedRoom.status === "OUT_OF_SERVICE") {
        return NextResponse.json(
          { error: `Room ${assignedRoom.roomNumber} is ${assignedRoom.status === "OUT_OF_ORDER" ? "out of order" : "out of service"} — assign a different room before check-in.` },
          { status: 400 }
        );
      }
      const property = await prisma.property.findUnique({
        where: { id: reservation.propertyId },
        select: { requireInspectionOnCheckIn: true },
      });
      if (property?.requireInspectionOnCheckIn && assignedRoom.status !== "INSPECTED") {
        return NextResponse.json(
          { error: `Room ${assignedRoom.roomNumber} has not been inspected — this property requires an inspected room before check-in (status: ${assignedRoom.status.replace(/_/g, " ").toLowerCase()}).` },
          { status: 400 }
        );
      }
      if (assignedRoom.status === "DIRTY") {
        roomWarning = `Room ${assignedRoom.roomNumber} has not been cleaned yet (status: Dirty).`;
      }
    }

    // 2. Perform the update in a transaction. Returns the billing folio's id so
    // callers (e.g. the front-desk check-in dialog) can post a payment immediately
    // after check-in without a second fetch.
    const folioId = await prisma.$transaction(async (tx) => {
      // Update Reservation Status. checkedInAt records the actual arrival time —
      // it orders guest Registration No assignment at EOD (check-in date then time).
      await tx.reservation.update({
        where: { id },
        data: { status: "IN_HOUSE", checkedInAt: new Date() }
      });

      // Create Folio if it doesn't exist — a pre-arrival deposit may already have
      // opened one, in which case the deposit is already on the billing window.
      const existingFolio = reservation.folios.find((f) => !f.isClosed) ?? reservation.folios[0];
      if (!existingFolio) {
        const folio = await tx.folio.create({
          data: {
            reservationId: id,
            propertyId: reservation.propertyId,
            folioNumber: 1,
            isClosed: false
          }
        });
        return folio.id;
      }
      return existingFolio.id;

      // Physical room status stays as-is (CLEAN/DIRTY) — occupancy is derived
      // from the reservation, not stored on the room.
    });

    await logActivity({
      ctx,
      module: "RESERVATIONS",
      action: "CHECK_IN",
      entityType: "Reservation",
      entityId: id,
      description: `Checked in ${reservation.confirmationNo}${assignedRoom ? ` to Room ${assignedRoom.roomNumber}` : ""}`,
    });

    return NextResponse.json({ success: true, folioId, ...(roomWarning && { roomWarning }) });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
