import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

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

    // 2. Perform the update in a transaction
    await prisma.$transaction(async (tx) => {
      // Update Reservation Status
      await tx.reservation.update({
        where: { id },
        data: { status: "IN_HOUSE" }
      });

      // Create Folio if it doesn't exist
      if (reservation.folios.length === 0) {
        await tx.folio.create({
          data: {
            reservationId: id,
            propertyId: reservation.propertyId,
            folioNumber: 1,
            isClosed: false
          }
        });
      }

      // Update physical room status to OCCUPIED?
      // In this PMS, we might just track physical room status as CLEAN/DIRTY.
      // The fact that it's occupied is derived from the reservation.
      // But we could enforce it. For now, we leave Room status as is (CLEAN/DIRTY).
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
