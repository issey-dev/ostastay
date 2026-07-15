import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId");

  try {
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { name: 'asc' }
    });
    return NextResponse.json(paymentMethods);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch payment methods" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.name || !body.type || !body.tenantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newPaymentMethod = await prisma.paymentMethod.create({
      data: {
        tenantId: body.tenantId,
        name: body.name,
        type: body.type,
        isActive: body.isActive ?? true,
      }
    });
    
    return NextResponse.json(newPaymentMethod, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create payment method" }, { status: 500 });
  }
}
