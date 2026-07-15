import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ReservationStatus } from "@/lib/enums";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    if (!body.status) {
      return NextResponse.json({ error: "Missing status field" }, { status: 400 });
    }

    const validStatuses = Object.values(ReservationStatus);
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Optional: add validation rules, e.g. checking if they have a roomId assigned before check-in.
    // For now, allow the state transition as requested.

    const updatedReservation = await prisma.reservation.update({
      where: { id },
      data: {
        status: body.status,
      },
    });

    return NextResponse.json(updatedReservation);
  } catch (error) {
    console.error("Failed to update reservation status:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
