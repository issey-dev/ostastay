import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, toErrorResponse } from "@/lib/scope";

export async function GET() {
  try {
    const ctx = await requireSession();

    const taxProfiles = await prisma.taxProfile.findMany({
      where: { enterpriseId: ctx.enterpriseId },
      include: {
        rates: {
          orderBy: { effectiveFrom: 'desc' }
        }
      }
    });
    return NextResponse.json(taxProfiles);
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

    if (!body.name || body.ratePercent === undefined || !body.effectiveFrom) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Create the profile and its initial rate in a single transaction
    const newTaxProfile = await prisma.taxProfile.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        name: body.name,
        description: body.description,
        rates: {
          create: {
            ratePercent: parseFloat(body.ratePercent),
            effectiveFrom: new Date(body.effectiveFrom),
          }
        }
      },
      include: {
        rates: true
      }
    });

    return NextResponse.json(newTaxProfile, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
