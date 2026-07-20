import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope";
import { slugify } from "@/lib/slug";
import { logActivity } from "@/lib/activity-log";

// Enterprise management is Osta-only — this is the renamed, real replacement for the old
// /api/tenants (which had zero auth and let anyone list/create tenants).
export async function GET() {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can manage enterprises");
    }
    requirePermission(ctx, "CONTROLS", "view");

    const enterprises = await prisma.enterprise.findMany({
      where: { type: "STANDARD" },
      include: { license: true, _count: { select: { properties: true, users: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(enterprises);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    if (!ctx.isInternal) {
      throw new ForbiddenError("Only Osta staff can create enterprises");
    }
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: "Enterprise name is required" }, { status: 400 });
    }

    const baseSlug = slugify(body.name);
    let slug = baseSlug;
    for (let attempt = 1; await prisma.enterprise.findUnique({ where: { slug } }); attempt++) {
      slug = `${baseSlug}-${attempt}`;
    }

    const enterprise = await prisma.enterprise.create({
      data: {
        name: body.name,
        slug,
        type: "STANDARD",
        license: {
          create: {
            tier: "STANDARD",
            maxProperties: typeof body.maxProperties === "number" ? body.maxProperties : 1,
          },
        },
      },
      include: { license: true },
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "Enterprise",
      entityId: enterprise.id,
      description: `Created enterprise "${enterprise.name}" (${enterprise.slug})`,
    });

    return NextResponse.json(enterprise, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
