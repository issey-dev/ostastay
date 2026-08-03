import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveBusinessDate } from "@/lib/business-date";
import { requireSession, resolveCurrentPropertyId, setCurrentPropertyId, toErrorResponse } from "@/lib/scope";

export async function GET() {
  try {
    const ctx = await requireSession();

    const rows =
      ctx.scope === "PROPERTY"
        ? await prisma.property.findMany({ where: { id: ctx.propertyId ?? undefined } })
        : await prisma.property.findMany({ where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });

    // Resolve the business date rather than passing the raw column through. Server-side
    // code has always applied resolveBusinessDate()'s fallback, but the client saw the
    // null — so a property whose date was never initialised gave the booking form
    // nothing to default Arrival to, and a walk-in (Arrival locked to the business date)
    // could not be booked at all. Both creation routes now seed the column and a
    // migration backfilled existing rows; this keeps the client correct regardless.
    const properties = rows.map((p) => ({ ...p, businessDate: resolveBusinessDate(p) }));

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
