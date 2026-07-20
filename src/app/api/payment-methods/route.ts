import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  try {
    const ctx = await requireSession();

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: { enterpriseId: ctx.enterpriseId },
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
    requirePermission(ctx, "CONTROLS", "create");

    const body = await request.json();

    if (!body.name || !body.type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newPaymentMethod = await prisma.paymentMethod.create({
      data: {
        enterpriseId: ctx.enterpriseId,
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
