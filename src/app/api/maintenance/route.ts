import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId");

  try {
    const maintenance = await prisma.roomMaintenance.findMany({
      where: propertyId ? { room: { propertyId } } : undefined,
      include: { 
        room: true,
        assignedTo: true 
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(maintenance);
  } catch (error) {
    console.error("Failed to fetch maintenance orders:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.roomId || !body.description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const order = await prisma.roomMaintenance.create({
      data: {
        roomId: body.roomId,
        issueType: body.issueType || "GENERAL",
        description: body.description,
        priority: body.priority || "MEDIUM",
        status: "OPEN",
      },
      include: { room: true }
    });

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    console.error("Failed to create maintenance order:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { ticketId, status, priority, assignedToId, issueType, description } = body;

    if (!ticketId) {
      return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
    }

    const dataToUpdate: any = {};
    if (status) dataToUpdate.status = status;
    if (priority) dataToUpdate.priority = priority;
    if (assignedToId !== undefined) dataToUpdate.assignedToId = assignedToId === null ? null : assignedToId;
    if (issueType) dataToUpdate.issueType = issueType;
    if (description) dataToUpdate.description = description;

    const updatedTicket = await prisma.roomMaintenance.update({
      where: { id: ticketId },
      data: dataToUpdate,
      include: { room: true }
    });

    return NextResponse.json(updatedTicket);
  } catch (error) {
    console.error("Failed to update maintenance order:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId");

    if (!ticketId) {
      return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
    }

    await prisma.roomMaintenance.delete({
      where: { id: ticketId }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete maintenance order:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
