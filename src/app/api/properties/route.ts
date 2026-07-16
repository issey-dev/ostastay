import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const enterpriseId = searchParams.get("enterpriseId");

  try {
    const properties = await prisma.property.findMany({
      where: enterpriseId ? { enterpriseId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(properties);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // TODO(Phase 1): replace with a real requireSession()/requirePermission(CONTROLS,'create')
    // check plus an EnterpriseLicense.maxProperties enforcement — see the approved plan.
    const isSuperAdmin = true;
    if (!isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized. Only Super Admins can create properties." }, { status: 403 });
    }

    // An Enterprise must already exist — no more auto-creating one from a client-supplied
    // id (that required a hardcoded id/name and can't work now that Enterprise.slug is a
    // required, unique field with no sensible default to invent here).
    const enterprise = await prisma.enterprise.findUnique({ where: { id: body.enterpriseId } });
    if (!enterprise) {
      return NextResponse.json({ error: "Enterprise not found" }, { status: 404 });
    }

    const newProperty = await prisma.property.create({
      data: {
        enterpriseId: body.enterpriseId,
        name: body.name,
        code: body.code,
        legalName: body.legalName,
        defaultCurrency: body.defaultCurrency,
        timeZone: body.timeZone,
        checkInTime: body.checkInTime,
        checkOutTime: body.checkOutTime,
        logoUrl: body.logoUrl,
        taxId: body.taxId,
        contactPhone: body.contactPhone,
        contactEmail: body.contactEmail,
      },
    });
    
    return NextResponse.json(newProperty, { status: 201 });
  } catch (error) {
    console.error("Failed to create property:", error);
    return NextResponse.json({ error: "Failed to create property" }, { status: 500 });
  }
}
