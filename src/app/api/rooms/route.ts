import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { RoomStatus } from "@/lib/enums";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId");

  try {
    const rooms = await prisma.room.findMany({
      where: propertyId ? { propertyId } : undefined,
      include: {
        roomType: true,
        floor: true,
        maintenance: { where: { status: { not: 'RESOLVED' } } }
      },
      orderBy: [
        { floor: { name: 'asc' } },
        { roomNumber: 'asc' }
      ]
    });
    return NextResponse.json(rooms);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch rooms" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.roomNumber || !body.propertyId || !body.roomTypeId || !body.floorId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newRoom = await prisma.room.create({
      data: {
        propertyId: body.propertyId,
        roomTypeId: body.roomTypeId,
        floorId: body.floorId,
        roomNumber: body.roomNumber,
        status: (body.status as RoomStatus) || RoomStatus.CLEAN,
      },
      include: {
        roomType: true,
        floor: true,
      }
    });
    
    return NextResponse.json(newRoom, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.status) {
      return NextResponse.json({ error: "New status is required" }, { status: 400 });
    }

    if (body.ids && Array.isArray(body.ids)) {
      // Bulk update
      const result = await prisma.room.updateMany({
        where: { id: { in: body.ids } },
        data: { status: body.status as RoomStatus },
      });
      return NextResponse.json({ success: true, count: result.count });
    }

    if (!body.id) {
      return NextResponse.json({ error: "Room ID or IDs array is required" }, { status: 400 });
    }

    const updatedRoom = await prisma.room.update({
      where: { id: body.id },
      data: { status: body.status as RoomStatus },
    });
    
    // In a real system, you would create an Audit Log entry here for the status change

    
    return NextResponse.json(updatedRoom);
  } catch (error) {
    return NextResponse.json({ error: "Failed to update room status" }, { status: 500 });
  }
}
