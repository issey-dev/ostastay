import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, resolveCurrentPropertyId, setCurrentPropertyId, toErrorResponse } from "@/lib/scope";

export async function GET() {
  try {
    const ctx = await requireSession();

    const properties =
      ctx.scope === "PROPERTY"
        ? await prisma.property.findMany({ where: { id: ctx.propertyId ?? undefined } })
        : await prisma.property.findMany({ where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });

    const currentPropertyId = await resolveCurrentPropertyId(ctx);

    return NextResponse.json({
      properties,
      currentPropertyId,
      isLocked: ctx.scope === "PROPERTY",
      enterpriseId: ctx.enterpriseId,
      // The caller's own user id — lets per-user views (e.g. the housekeeping
      // task sheet's "my rooms" default) know who "me" is without a new endpoint.
      userId: ctx.userId,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json();
    if (!body.propertyId) {
      return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    }
    await setCurrentPropertyId(ctx, body.propertyId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
