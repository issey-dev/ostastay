import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { amenitySchema, amenityDescription } from "@/lib/facility-amenity";
import { amenityNameTaken } from "@/lib/facility-amenity-db";

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

const postSchema = amenitySchema.extend({ propertyId: z.string().min(1, "Property ID is required") });

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "create");

    const parsed = postSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid amenity" }, { status: 400 });
    }
    const data = parsed.data;
    await assertPropertyAccess(ctx, data.propertyId);

    if (await amenityNameTaken(data.propertyId, data.name)) {
      return NextResponse.json({ error: `An amenity called "${data.name}" already exists at this property` }, { status: 409 });
    }

    const newFacility = await prisma.facility.create({
      data: {
        propertyId: data.propertyId,
        name: data.name,
        description: amenityDescription(data.description),
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
