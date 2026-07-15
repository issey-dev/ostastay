import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const propertyId = searchParams.get("propertyId");

  try {
    const facilities = await prisma.facility.findMany({
      where: propertyId ? { propertyId } : undefined,
    });
    return NextResponse.json(facilities);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch facilities" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (!body.name || !body.propertyId) {
      return NextResponse.json({ error: "Name and Property ID are required" }, { status: 400 });
    }

    const newFacility = await prisma.facility.create({
      data: {
        propertyId: body.propertyId,
        name: body.name,
        description: body.description,
      },
    });
    
    return NextResponse.json(newFacility, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create facility" }, { status: 500 });
  }
}
