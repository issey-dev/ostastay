import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RoomStatus } from "@/lib/enums";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, propertyId);

    const rooms = await prisma.room.findMany({
      where: { propertyId },
      include: {
        roomType: { include: { features: true } },
        floor: true,
        features: true,
        maintenance: { where: { status: { not: 'RESOLVED' } } }
      },
      orderBy: [
        { floor: { name: 'asc' } },
        { roomNumber: 'asc' }
      ]
    });
    return NextResponse.json(rooms);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();

    if (!body.roomNumber || !body.propertyId || !body.roomTypeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    const roomType = await prisma.roomType.findUnique({ where: { id: body.roomTypeId } });
    if (!roomType || roomType.propertyId !== body.propertyId) {
      return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 });
    }
    if (!roomType.isActive) {
      return NextResponse.json({ error: "Cannot add a room to an inactive room type" }, { status: 400 });
    }

    // A Pseudo room type has no physical location — Building/Floor are skipped
    // entirely, never just left blank by mistake.
    let floorId: string | null = null;
    if (!roomType.isPseudo) {
      if (!body.floorId) {
        return NextResponse.json({ error: "Floor is required for a physical room" }, { status: 400 });
      }
      const floor = await prisma.floor.findUnique({ where: { id: body.floorId }, include: { building: true } });
      if (!floor || floor.building.propertyId !== body.propertyId) {
        return NextResponse.json({ error: "Floor does not belong to this property" }, { status: 400 });
      }
      floorId = body.floorId;
    }

    const features = Array.isArray(body.features) ? body.features : [];

    const newRoom = await prisma.room.create({
      data: {
        propertyId: body.propertyId,
        roomTypeId: body.roomTypeId,
        floorId,
        roomNumber: body.roomNumber,
        status: (body.status as RoomStatus) || RoomStatus.CLEAN,
        features: features.length > 0 && !roomType.isPseudo ? { create: features } : undefined,
      },
      include: {
        roomType: { include: { features: true } },
        floor: true,
        features: true,
      }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "Room",
      entityId: newRoom.id,
      description: `Created room ${newRoom.roomNumber}`,
    });

    return NextResponse.json(newRoom, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "HOUSEKEEPING", "update");

    const body = await request.json();

    if (!body.status) {
      return NextResponse.json({ error: "New status is required" }, { status: 400 });
    }

    if (body.ids && Array.isArray(body.ids)) {
      // Bulk update — confirm every targeted room belongs to a property this actor can
      // reach before touching any of them (a guessed id from another enterprise/property
      // must not be silently included).
      const rooms = await prisma.room.findMany({ where: { id: { in: body.ids } } });
      const distinctPropertyIds = [...new Set(rooms.map((r) => r.propertyId))];
      for (const propertyId of distinctPropertyIds) {
        await assertPropertyAccess(ctx, propertyId);
      }

      const result = await prisma.room.updateMany({
        where: { id: { in: rooms.map((r) => r.id) } },
        data: { status: body.status as RoomStatus },
      });

      await logActivity({
        ctx,
        module: "HOUSEKEEPING",
        action: "UPDATE",
        entityType: "Room",
        description: `Set ${result.count} room(s) to ${body.status} (${rooms.map((r) => r.roomNumber).join(", ")})`,
      });

      return NextResponse.json({ success: true, count: result.count });
    }

    if (!body.id) {
      return NextResponse.json({ error: "Room ID or IDs array is required" }, { status: 400 });
    }

    const existing = await prisma.room.findUnique({ where: { id: body.id } });
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, existing.propertyId);

    const updatedRoom = await prisma.room.update({
      where: { id: body.id },
      data: { status: body.status as RoomStatus },
    });

    await logActivity({
      ctx,
      module: "HOUSEKEEPING",
      action: "UPDATE",
      entityType: "Room",
      entityId: updatedRoom.id,
      description: `Set room ${updatedRoom.roomNumber} status to ${body.status}`,
    });

    return NextResponse.json(updatedRoom);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
