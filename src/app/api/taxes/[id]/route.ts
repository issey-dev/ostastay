import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Prepare update data
    const updateData: any = {
      name: body.name,
      description: body.description,
    };

    // If ratePercent and effectiveFrom are provided, we should add a new rate
    // assuming it represents a new effective rate entry
    if (body.ratePercent !== undefined && body.effectiveFrom) {
      updateData.rates = {
        create: {
          ratePercent: parseFloat(body.ratePercent),
          effectiveFrom: new Date(body.effectiveFrom),
        },
      };
    }

    const updatedTaxProfile = await prisma.taxProfile.update({
      where: { id },
      data: updateData,
      include: {
        rates: {
          orderBy: { effectiveFrom: "desc" },
        },
      },
    });

    return NextResponse.json(updatedTaxProfile);
  } catch (error) {
    console.error("Failed to update tax profile:", error);
    return NextResponse.json({ error: "Failed to update tax profile" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await prisma.taxProfile.delete({
      where: { id },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Failed to delete tax profile:", error);
    return NextResponse.json({ error: "Failed to delete tax profile" }, { status: 500 });
  }
}
