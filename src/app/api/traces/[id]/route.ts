import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    if (body.isResolved === undefined) {
      return NextResponse.json({ error: "Missing isResolved field" }, { status: 400 });
    }

    const trace = await prisma.reservationTrace.update({
      where: { id },
      data: {
        isResolved: body.isResolved
      }
    });

    return NextResponse.json(trace);
  } catch (error) {
    console.error("Failed to update trace", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.reservationTrace.delete({
      where: { id }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete trace", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
