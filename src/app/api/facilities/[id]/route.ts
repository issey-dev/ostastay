import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";
import { amenitySchema, amenityDescription } from "@/lib/facility-amenity";
import { amenityNameTaken } from "@/lib/facility-amenity-db";

// Edit / remove one property amenity (Hub › property › Outlets › Amenities). Same guard
// style as the sibling routes: CONTROLS permission, then the amenity's own property
// must be one the user can reach.

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");
    const { id } = await params;

    const existing = await prisma.facility.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Amenity not found" }, { status: 404 });
    await assertPropertyAccess(ctx, existing.propertyId);

    const parsed = amenitySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid amenity" }, { status: 400 });
    }
    const data = parsed.data;
    if (await amenityNameTaken(existing.propertyId, data.name, id)) {
      return NextResponse.json({ error: `An amenity called "${data.name}" already exists at this property` }, { status: 409 });
    }

    const updated = await prisma.facility.update({
      where: { id },
      data: { name: data.name, description: amenityDescription(data.description) },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "Facility",
      entityId: id,
      description: `Updated facility "${updated.name}"`,
    });

    return NextResponse.json(updated);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");
    const { id } = await params;

    const existing = await prisma.facility.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Amenity not found" }, { status: 404 });
    await assertPropertyAccess(ctx, existing.propertyId);

    await prisma.facility.delete({ where: { id } });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "Facility",
      entityId: id,
      description: `Deleted facility "${existing.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
