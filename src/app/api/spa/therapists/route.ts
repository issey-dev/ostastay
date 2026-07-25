import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, hasPermission, assertPropertyModuleAccess, ForbiddenError, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

const includeShape = {
  skills: { include: { treatment: { select: { id: true, name: true } } } },
  schedules: { orderBy: { dayOfWeek: "asc" as const } },
  exceptions: { orderBy: { date: "asc" as const } },
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
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
    // Readable by a SPA booking user OR a CONTROLS catalog manager, but not by a user with neither.
    if (!hasPermission(ctx, "SPA", "view") && !hasPermission(ctx, "CONTROLS", "view")) {
      throw new ForbiddenError("Missing view permission on Spa");
    }

    const therapists = await prisma.spaTherapist.findMany({
      where: { propertyId },
      include: includeShape,
      orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }],
    });
    return NextResponse.json(therapists);
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
    if (!body.propertyId || !body.displayName) {
      return NextResponse.json({ error: "Missing required fields (propertyId, displayName)" }, { status: 400 });
    }
    await assertPropertyModuleAccess(ctx, body.propertyId, "SPA");

    // Optional link to a PMS login — must be a user of this enterprise, and each user maps
    // to at most one therapist (the schema's @unique enforces that; we surface a clean error).
    if (body.userId) {
      const linkUser = await prisma.user.findUnique({ where: { id: body.userId }, include: { spaTherapistProfile: true } });
      if (!linkUser || linkUser.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Linked user not found" }, { status: 404 });
      }
      if (linkUser.spaTherapistProfile) {
        return NextResponse.json({ error: "That user is already linked to another therapist" }, { status: 400 });
      }
    }

    const therapist = await prisma.spaTherapist.create({
      data: {
        propertyId: body.propertyId,
        userId: body.userId || null,
        displayName: body.displayName,
        gender: body.gender || null,
        phone: body.phone || null,
        email: body.email || null,
        isActive: body.isActive !== undefined ? !!body.isActive : true,
        bookable: body.bookable !== undefined ? !!body.bookable : true,
        displayOrder: body.displayOrder !== undefined ? parseInt(body.displayOrder) : 0,
      },
      include: includeShape,
    });

    await logActivity({
      ctx, module: "CONTROLS", action: "CREATE", entityType: "SpaTherapist", entityId: therapist.id,
      description: `Created spa therapist "${therapist.displayName}"`,
    });

    return NextResponse.json(therapist, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
