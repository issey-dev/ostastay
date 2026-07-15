import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { lineItemIds, targetFolioId } = body;

    if (!lineItemIds || !Array.isArray(lineItemIds) || lineItemIds.length === 0 || !targetFolioId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify target folio exists
    const targetFolio = await prisma.folio.findUnique({
      where: { id: targetFolioId }
    });

    if (!targetFolio) {
      return NextResponse.json({ error: "Target folio not found" }, { status: 404 });
    }

    // Move the line items
    await prisma.folioLineItem.updateMany({
      where: {
        id: { in: lineItemIds }
      },
      data: {
        folioId: targetFolioId
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to move line items:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
