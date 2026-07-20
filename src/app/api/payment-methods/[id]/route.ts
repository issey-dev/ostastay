import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "update");

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    const updatedPaymentMethod = await prisma.paymentMethod.update({
      where: { id },
      data: {
        name: body.name !== undefined ? body.name : undefined,
        type: body.type !== undefined ? body.type : undefined,
        isActive: body.isActive !== undefined ? body.isActive : undefined,
      }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "PaymentMethod",
      entityId: updatedPaymentMethod.id,
      description: `Updated payment method "${updatedPaymentMethod.name}" (${updatedPaymentMethod.type})`,
    });

    return NextResponse.json(updatedPaymentMethod);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CONTROLS", "delete");

    const { id } = await params;
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    await prisma.paymentMethod.delete({
      where: { id }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "PaymentMethod",
      entityId: id,
      description: `Deleted payment method "${existing.name}" (${existing.type})`,
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
