import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

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

    if (!body.code || !body.description || !body.taxProfileId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const taxProfile = await prisma.taxProfile.findUnique({ where: { id: body.taxProfileId } });
    if (!taxProfile || taxProfile.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Tax profile not found" }, { status: 404 });
    }

    const newChargeCode = await prisma.chargeCode.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        code: body.code.toUpperCase(),
        description: body.description,
        taxProfileId: body.taxProfileId,
      },
      include: {
        taxProfile: true
      }
    });

    return NextResponse.json(newChargeCode, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
