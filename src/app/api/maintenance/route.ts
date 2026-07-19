import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "MAINTENANCE", "view");

    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const maintenance = await prisma.roomMaintenance.findMany({
      where: { room: { propertyId } },
      include: {
        room: true,
        assignedTo: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(maintenance);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "MAINTENANCE", "create");

    const body = await request.json();

    if (!body.roomId || !body.description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const room = await prisma.room.findUnique({ where: { id: body.roomId }, include: { roomType: true } });
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, room.propertyId);
    if (!room.roomType.housekeepingEnabled) {
      return NextResponse.json({ error: "This room's room type does not offer housekeeping" }, { status: 400 });
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
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "MAINTENANCE", "update");

    const body = await request.json();
    const { ticketId, status, priority, assignedToId, issueType, description } = body;

    if (!ticketId) {
      return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
    }

    const existing = await prisma.roomMaintenance.findUnique({
      where: { id: ticketId },
      include: { room: true }
    });
    if (!existing) {
      return NextResponse.json({ error: "Maintenance ticket not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.room.propertyId);

    const dataToUpdate: any = {};
    if (status) dataToUpdate.status = status;
    if (priority) dataToUpdate.priority = priority;
    if (assignedToId !== undefined) {
      if (assignedToId !== null) {
        const assignee = await prisma.user.findUnique({ where: { id: assignedToId } });
        if (!assignee || assignee.enterpriseId !== ctx.enterpriseId) {
          return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
        }
      }
      dataToUpdate.assignedToId = assignedToId;
    }
    if (issueType) dataToUpdate.issueType = issueType;
    if (description) dataToUpdate.description = description;

    const updatedTicket = await prisma.roomMaintenance.update({
      where: { id: ticketId },
      data: dataToUpdate,
      include: { room: true }
    });

    return NextResponse.json(updatedTicket);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "MAINTENANCE", "delete");

    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId");

    if (!ticketId) {
      return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
    }

    const existing = await prisma.roomMaintenance.findUnique({
      where: { id: ticketId },
      include: { room: true }
    });
    if (!existing) {
      return NextResponse.json({ error: "Maintenance ticket not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.room.propertyId);

    await prisma.roomMaintenance.delete({
      where: { id: ticketId }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
