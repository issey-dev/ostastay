import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

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

    // 1. Double check they don't already have an active shift
    const existingShift = await prisma.cashierShift.findFirst({
      where: {
        enterpriseId,
        userId,
        closedAt: null
      }
    });

    if (existingShift) {
      return NextResponse.json({ error: "You already have an active shift. Please close it first." }, { status: 400 });
    }

    // 2. Open new shift
    const newShift = await prisma.cashierShift.create({
      data: {
        enterpriseId,
        userId,
        openingFloat: openingFloat
      }
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
