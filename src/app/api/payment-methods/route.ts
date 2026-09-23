import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, assertPropertyAccess, requirePropertySetup, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// Per property since 2026-09-23 (.agents/docs/HUB_SETUP_PLAN.md, Phase 2): each property accepts its own payment methods.
// GET takes ?propertyId= and is readable by anyone working at that property; POST takes a
// body propertyId and is Property Setup for it.
export async function GET(request: Request) {
  try {
    const ctx = await requireSession();
    const propertyId = new URL(request.url).searchParams.get("propertyId");
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await assertPropertyAccess(ctx, propertyId);

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { propertyId },
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(paymentMethods);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    const body = await request.json();
    const propertyId: string | undefined = body.propertyId;
    if (!propertyId) return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
    await requirePropertySetup(ctx, propertyId, "CONTROLS", "create");

    if (!body.name || !body.type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newPaymentMethod = await prisma.paymentMethod.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        propertyId,
        name: body.name,
        type: body.type,
        isActive: body.isActive ?? true,
      }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "PaymentMethod",
      entityId: newPaymentMethod.id,
      description: `Created payment method "${newPaymentMethod.name}" (${newPaymentMethod.type})`,
    });

    return NextResponse.json(newPaymentMethod, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
