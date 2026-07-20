import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";
import { logActivity } from "@/lib/activity-log";

// PAYMENT removed — payment types are Payment Methods, not charge codes.
const CATEGORIES = ["ROOM", "FOOD_BEVERAGE", "TRANSPORTATION", "OTHERS", "TAX", "SYSTEM", "NON_REVENUE"];

export async function GET() {
  try {
    const ctx = await requireSession();

    const chargeCodes = await prisma.chargeCode.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        taxProfile: {
          include: {
            rates: {
              orderBy: { effectiveFrom: 'desc' },
              take: 1
            }
          }
        }
      },
      orderBy: { code: 'asc' }
    });
    return NextResponse.json(chargeCodes);
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

    if (!body.code || !body.description || !body.category) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (!CATEGORIES.includes(body.category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const useDefaultTax = body.useDefaultTax !== undefined ? !!body.useDefaultTax : true;
    let taxProfileId: string | null = null;
    if (!useDefaultTax) {
      if (!body.taxProfileId) {
        return NextResponse.json({ error: "A Custom Tax profile is required when not using the default tax" }, { status: 400 });
      }
      const taxProfile = await prisma.taxProfile.findUnique({ where: { id: body.taxProfileId } });
      if (!taxProfile || taxProfile.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
      }
      taxProfileId = body.taxProfileId;
    }

    const newChargeCode = await prisma.chargeCode.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        code: body.code.toUpperCase(),
        description: body.description,
        category: body.category,
        useDefaultTax,
        taxProfileId,
      },
      include: {
        taxProfile: true
      }
    });

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      entityType: "ChargeCode",
      entityId: newChargeCode.id,
      description: `Created charge code ${newChargeCode.code} — ${newChargeCode.description}`,
    });

    return NextResponse.json(newChargeCode, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
