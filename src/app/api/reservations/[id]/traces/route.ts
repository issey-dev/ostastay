import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const traces = await prisma.reservationTrace.findMany({
      where: { reservationId: id },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(traces);
  } catch (error) {
    console.error("Failed to fetch traces", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    
    if (!body.traceType || !body.description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const trace = await prisma.reservationTrace.create({
      data: {
        reservationId: id,
        traceType: body.traceType,
        description: body.description,
        actionDate: body.actionDate ? new Date(body.actionDate) : null,
      }
    });

    return NextResponse.json(trace, { status: 201 });
  } catch (error) {
    console.error("Failed to create trace", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
