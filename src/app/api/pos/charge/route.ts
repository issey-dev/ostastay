import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { folioId, amount, chargeCodeId, description, reference } = body

    if (!folioId || !amount || !chargeCodeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Verify folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId }
    })

    if (!folio) return NextResponse.json({ error: "Folio not found" }, { status: 404 })
    if (folio.isClosed) return NextResponse.json({ error: "Cannot post charges to a closed folio" }, { status: 400 })

    // Fetch Tenant Settings for Tax calculation
    const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000000";
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: DEMO_TENANT_ID }
    });

    const inputAmount = parseFloat(amount);
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
        chargeCodeId,
        amount: baseAmount,
        taxAmount: calculatedTaxAmount,
        serviceChargeAmount: serviceChargeAmount,
        description: (description || "POS Charge") + (reference ? ` | Ref: ${reference}` : ""),
        date: new Date()
      },
      include: {
        chargeCode: true
      }
    })

    return NextResponse.json(lineItem)
  } catch (error) {
    console.error("Error posting POS charge:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
