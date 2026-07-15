import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(tenants);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch tenants" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.name) {
      return NextResponse.json({ error: "Tenant name is required" }, { status: 400 });
    }

    const newTenant = await prisma.tenant.create({
      data: {
        name: body.name,
      },
    });
    
    return NextResponse.json(newTenant, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create tenant" }, { status: 500 });
  }
}
