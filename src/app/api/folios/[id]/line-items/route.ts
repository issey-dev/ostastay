import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: folioId } = await params;
    const body = await request.json();

    if (!body.chargeCodeId || !body.amount || !body.description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check if folio exists and is open
    const folio = await prisma.folio.findUnique({ where: { id: folioId } });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot post charges to a closed folio" }, { status: 400 });
    }

    // Fetch Tenant Settings for Tax calculation
    const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000000";
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: DEMO_TENANT_ID }
    });

    const inputAmount = parseFloat(body.amount);
    let baseAmount = inputAmount;
    let serviceChargeAmount = 0.0;
    let calculatedTaxAmount = 0.0;

    if (settings) {
      const serviceRate = settings.serviceChargeEnabled ? (settings.serviceChargeRate / 100) : 0.0;
      const tgstRateFraction = settings.tgstEnabled ? (settings.tgstRate / 100) : 0.0;

      if (settings.pricesIncludeTaxes) {
        // Extract taxes (tax-inclusive rate)
        baseAmount = inputAmount / ((1 + serviceRate) * (1 + tgstRateFraction));
        serviceChargeAmount = baseAmount * serviceRate;
        calculatedTaxAmount = (baseAmount + serviceChargeAmount) * tgstRateFraction;
      } else {
        // Add taxes on top (tax-exclusive rate)
        baseAmount = inputAmount;
        serviceChargeAmount = baseAmount * serviceRate;
        calculatedTaxAmount = (baseAmount + serviceChargeAmount) * tgstRateFraction;
      }
    }

    baseAmount = Math.round(baseAmount * 100) / 100;
    serviceChargeAmount = Math.round(serviceChargeAmount * 100) / 100;
    calculatedTaxAmount = Math.round(calculatedTaxAmount * 100) / 100;

    const lineItem = await prisma.folioLineItem.create({
      data: {
        folioId,
        chargeCodeId: body.chargeCodeId,
        date: new Date(),
        description: body.description,
        amount: baseAmount,
        taxAmount: calculatedTaxAmount,
        serviceChargeAmount: serviceChargeAmount,
      },
      include: {
        chargeCode: true
      }
    });

    return NextResponse.json(lineItem, { status: 201 });
  } catch (error) {
    console.error("Failed to post line item:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
