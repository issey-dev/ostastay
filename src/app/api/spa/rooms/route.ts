import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyModuleAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const includeShape = {
  compatibleTreatments: { include: { treatment: { select: { id: true, name: true } } } },
  exceptions: { orderBy: { date: "asc" as const } },
};

export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const { searchParams } = new URL(request.url);
    const propertyId = searchParams.get("propertyId");
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, propertyId, "SPA");

    const rooms = await prisma.spaRoom.findMany({
      where: { propertyId },
      include: includeShape,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
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
    if (!body.propertyId || !body.name) {
      return NextResponse.json({ error: "Missing required fields (propertyId, name)" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, body.propertyId, "SPA");

    const capacity = body.capacity !== undefined ? parseInt(body.capacity) : 1;
    if (isNaN(capacity) || capacity < 1) {
      return NextResponse.json({ error: "capacity must be at least 1" }, { status: 400 });
    }

    const room = await prisma.spaRoom.create({
      data: {
        propertyId: body.propertyId,
        name: body.name,
        code: body.code || null,
        description: body.description || null,
        capacity,
        roomType: body.roomType || null,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
        bookable: body.bookable !== undefined ? !!body.bookable : true,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : 0,
      },
      include: includeShape,
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "SpaRoom", entityId: room.id,
      description: `Created spa room "${room.name}"`,
    });

    return NextResponse.json(room, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
