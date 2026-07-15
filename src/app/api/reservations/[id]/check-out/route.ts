import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // 1. Fetch reservation and folios with their line items and payments
    const reservation = await prisma.reservation.findUnique({
      where: { id },
      include: {
        assignments: { orderBy: { startDate: 'desc' } },
        folios: {
          include: {
            lineItems: true,
            payments: true
          }
        }
      }
    });

    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    if (reservation.status !== "IN_HOUSE") {
      return NextResponse.json({ error: "Only in-house guests can be checked out" }, { status: 400 });
    }

    // 2. Calculate balance
    let totalCharges = 0;
    let totalPayments = 0;

    for (const folio of reservation.folios) {
      for (const item of folio.lineItems) {
        if (!item.isVoid) {
          totalCharges += (item.amount + item.taxAmount + (item.serviceChargeAmount || 0));
        }
      }
      for (const payment of folio.payments) {
        if (!payment.isRefund) {
          totalPayments += payment.amount;
        } else {
          totalPayments -= payment.amount;
        }
      }
    }

    // Allow a small floating point tolerance
    const balance = totalCharges - totalPayments;
    if (Math.abs(balance) > 0.01) {
      return NextResponse.json({ 
        error: "Cannot check out with an outstanding balance",
        balance
      }, { status: 400 });
    }

    // 3. Perform check-out in transaction
    await prisma.$transaction(async (tx) => {
      // Update Reservation Status
      await tx.reservation.update({
        where: { id },
        data: { status: "CHECKED_OUT" }
      });

      // Update Room Status to DIRTY
      const activeRoomId = reservation.assignments[0]?.roomId;
      if (activeRoomId) {
        await tx.room.update({
          where: { id: activeRoomId },
          data: { status: "DIRTY" }
        });
      }
      
      // Close all folios
      for (const folio of reservation.folios) {
        if (!folio.isClosed) {
          await tx.folio.update({
            where: { id: folio.id },
            data: { isClosed: true }
          });
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Check-out error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
