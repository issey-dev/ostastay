import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.code || !body.description || !body.taxProfileId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const updatedChargeCode = await prisma.chargeCode.update({
      where: { id },
      data: {
        code: body.code.toUpperCase(),
        description: body.description,
        taxProfileId: body.taxProfileId,
      },
      include: {
        taxProfile: {
          include: {
            rates: {
              orderBy: { effectiveFrom: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    return NextResponse.json(updatedChargeCode);
  } catch (error) {
    console.error("Failed to update charge code:", error);
    return NextResponse.json({ error: "Failed to update charge code" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Optional Check: Is this charge code already used in FolioLineItems?
    const existingFolios = await prisma.folioLineItem.findFirst({
      where: { chargeCodeId: id }
    });

    if (existingFolios) {
      return NextResponse.json(
        { error: "Cannot delete this Charge Code as it is currently linked to active Folio Line Items." },
        { status: 400 }
      );
    }

    await prisma.chargeCode.delete({
      where: { id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete charge code:", error);
    return NextResponse.json({ error: "Failed to delete charge code" }, { status: 500 });
  }
}
