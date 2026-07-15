import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const openingFloat = parseFloat(body.openingFloat);

    if (isNaN(openingFloat) || openingFloat < 0) {
      return NextResponse.json({ error: "Invalid opening float amount" }, { status: 400 });
    }

    const tenantId = String(session.tenantId);
    const userId = String(session.id);

    // 1. Double check they don't already have an active shift
    const existingShift = await prisma.cashierShift.findFirst({
      where: {
        tenantId: tenantId,
        userId: userId,
        closedAt: null
      }
    });

    if (existingShift) {
      return NextResponse.json({ error: "You already have an active shift. Please close it first." }, { status: 400 });
    }

    // 2. Open new shift
    const newShift = await prisma.cashierShift.create({
      data: {
        tenantId: tenantId,
        userId: userId,
        openingFloat: openingFloat
      }
    });

    return NextResponse.json({
      success: true,
      data: newShift
    });

  } catch (error) {
    console.error("Open Shift Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
