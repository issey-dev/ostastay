import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

    const order = await prisma.roomMaintenance.update({
      where: { id },
      data: {
        status: body.status
      }
    });

    return NextResponse.json(order);
  } catch (error) {
    console.error("Failed to update maintenance order", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.roomMaintenance.delete({
      where: { id }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete maintenance order", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
