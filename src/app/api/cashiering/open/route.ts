import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, resolveCurrentPropertyId, toErrorResponse } from "@/lib/scope";
import { resolveBusinessDate } from "@/lib/business-date";
import { findOpenShift } from "@/lib/cashier-shift";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const body = await request.json();
    const openingFloat = parseFloat(body.openingFloat);

    if (isNaN(openingFloat) || openingFloat < 0) {
      return NextResponse.json({ error: "Invalid opening float amount" }, { status: 400 });
    }

    const enterpriseId = ctx.enterpriseId;
    const userId = ctx.userId;

    // A shift belongs to (user, property) — resolve the property the caller is working.
    const propertyId = await resolveCurrentPropertyId(ctx);
    if (!propertyId) {
      return NextResponse.json({ error: "No property selected for this cashier session." }, { status: 400 });
    }
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    const businessDate = property ? resolveBusinessDate(property) : null;

    // 1. Reuse an auto-opened (0-float) shift for this property if one exists — record
    //    the real opening float on it; otherwise block a genuine second open shift.
    const existingShift = await findOpenShift(userId, propertyId);
    if (existingShift) {
      if (existingShift.openingFloat === 0 && openingFloat > 0) {
        const updated = await prisma.cashierShift.update({
          where: { id: existingShift.id },
          data: { openingFloat },
        });
        await logActivity({ ctx, module: "CASHIERING", action: "SHIFT_OPEN", entityType: "CashierShift", entityId: updated.id, description: `Set opening float $${openingFloat.toFixed(2)}` });
        return NextResponse.json({ success: true, data: updated });
      }
      return NextResponse.json({ error: "You already have an active shift for this property. Please close it first." }, { status: 400 });
    }

    // 2. Open new shift
    const newShift = await prisma.cashierShift.create({
      data: {
        enterpriseId,
        userId,
        propertyId,
        businessDate,
        openingFloat: openingFloat
      }
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "SHIFT_OPEN",
      entityType: "CashierShift",
      entityId: newShift.id,
      description: `Opened cashier shift with $${openingFloat.toFixed(2)} float`,
    });

    return NextResponse.json({
      success: true,
      data: newShift
    });

  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
