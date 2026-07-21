import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

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

    // Optionally pull the room from inventory at report time — the ticket's
    // description becomes the OOO reason; expectedReturn is informational.
    if (body.takeOutOfOrder) {
      await prisma.room.update({
        where: { id: body.roomId },
        data: {
          status: "OUT_OF_ORDER",
          oooReason: body.description,
          oooExpectedReturn: body.expectedReturn ? new Date(body.expectedReturn) : null,
        },
      });
    }

    await logActivity({
      ctx,
      module: "MAINTENANCE",
      action: "CREATE",
      entityType: "RoomMaintenance",
      entityId: order.id,
      description: `Opened ${order.issueType} maintenance ticket for room ${room.roomNumber}: ${order.description}`,
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

    // Resolving the ticket returns an out-of-order room to service — as DIRTY,
    // not CLEAN (post-repair rooms need a housekeeping pass before sale).
    if (status === "RESOLVED" && existing.room.status === "OUT_OF_ORDER") {
      await prisma.room.update({
        where: { id: existing.roomId },
        data: { status: "DIRTY", oooReason: null, oooExpectedReturn: null },
      });
    }

    await logActivity({
      ctx,
      module: "MAINTENANCE",
      action: "UPDATE",
      entityType: "RoomMaintenance",
      entityId: updatedTicket.id,
      description: `Updated maintenance ticket for room ${updatedTicket.room.roomNumber}${status ? ` — status ${status}` : ""}`,
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

    await logActivity({
      ctx,
      module: "MAINTENANCE",
      action: "DELETE",
      entityType: "RoomMaintenance",
      entityId: ticketId,
      description: `Deleted maintenance ticket for room ${existing.room.roomNumber} (${existing.issueType})`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
