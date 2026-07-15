import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");

  try {
    const taxProfiles = await prisma.taxProfile.findMany({
      where: tenantId ? { tenantId } : undefined,
      include: {
        rates: {
          orderBy: { effectiveFrom: 'desc' }
        }
      }
    });
    return NextResponse.json(taxProfiles);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch tax profiles" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.name || !body.tenantId || body.ratePercent === undefined || !body.effectiveFrom) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Create the profile and its initial rate in a single transaction
    const newTaxProfile = await prisma.taxProfile.create({
      data: {
        tenantId: body.tenantId,
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
    return NextResponse.json({ error: "Failed to create tax profile" }, { status: 500 });
  }
}
