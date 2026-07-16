import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId");

  try {
    const chargeCodes = await prisma.chargeCode.findMany({
      where: enterpriseId ? { enterpriseId } : undefined,
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
    return NextResponse.json({ error: "Failed to fetch charge codes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.code || !body.description || !body.enterpriseId || !body.taxProfileId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newChargeCode = await prisma.chargeCode.create({
      data: {
        enterpriseId: body.enterpriseId,
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
    return NextResponse.json({ error: "Failed to create charge code" }, { status: 500 });
  }
}
