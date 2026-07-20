import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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

    const facilities = await prisma.facility.findMany({
      where: { propertyId },
    });
    return NextResponse.json(facilities);
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

    if (!body.name || !body.propertyId) {
      return NextResponse.json({ error: "Name and Property ID are required" }, { status: 400 });
    }
    await assertPropertyAccess(ctx, body.propertyId);

    const newFacility = await prisma.facility.create({
      data: {
        propertyId: body.propertyId,
        name: body.name,
        description: body.description,
      },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "Facility",
      entityId: newFacility.id,
      description: `Created facility "${newFacility.name}"`,
    });

    return NextResponse.json(newFacility, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
