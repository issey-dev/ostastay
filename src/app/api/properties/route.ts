import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");

  try {
    const properties = await prisma.property.findMany({
      where: tenantId ? { tenantId } : undefined,
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
    
    // Basic RBAC check stub: In a real app, verify the user's session has "Super Admin" role
    const isSuperAdmin = true; 
    if (!isSuperAdmin) {
      return NextResponse.json({ error: "Unauthorized. Only Super Admins can create properties." }, { status: 403 });
    }

    // PoC: Automatically ensure the dummy tenant exists to prevent foreign key errors
    await prisma.tenant.upsert({
      where: { id: body.tenantId },
      update: {},
      create: {
        id: body.tenantId,
        name: "Demo Tenant",
      },
    });

    const newProperty = await prisma.property.create({
      data: {
        tenantId: body.tenantId,
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
