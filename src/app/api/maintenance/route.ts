import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { isValidMaintenanceIssueType, isValidMaintenancePriority } from "@/lib/maintenance";

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
    if (body.issueType !== undefined && !isValidMaintenanceIssueType(body.issueType)) {
      return NextResponse.json({ error: "Invalid issue type" }, { status: 400 });
    }
    if (body.priority !== undefined && !isValidMaintenancePriority(body.priority)) {
      return NextResponse.json({ error: "Invalid priority — expected LOW, MEDIUM, or HIGH" }, { status: 400 });
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

// PATCH and DELETE moved to the RESTful /api/maintenance/[id] route —
// this collection route is GET (list) + POST (create) only.
