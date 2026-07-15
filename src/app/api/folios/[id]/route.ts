import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch the folio to verify it exists and check if it has line items or payments
    const folio = await prisma.folio.findUnique({
      where: { id },
      include: {
        lineItems: true,
        payments: true
      }
    });

    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }

    if (folio.folioNumber === 1) {
      return NextResponse.json({ error: "Cannot delete the primary folio (Folio 1)" }, { status: 400 });
    }

    if (folio.lineItems.length > 0 || folio.payments.length > 0) {
      return NextResponse.json({ error: "Cannot delete a folio that has charges or payments" }, { status: 400 });
    }

    await prisma.folio.delete({
      where: { id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete folio:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { payeeProfileId } = body;

    const updatedFolio = await prisma.folio.update({
      where: { id },
      data: { payeeProfileId },
      include: {
        payeeProfile: true,
        lineItems: {
          include: { chargeCode: true },
          orderBy: { date: 'asc' }
        },
        payments: {
          include: { paymentMethod: true, shift: true },
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    return NextResponse.json(updatedFolio);
  } catch (error) {
    console.error("Failed to update folio:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

