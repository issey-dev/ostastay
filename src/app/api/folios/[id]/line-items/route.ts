import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession();
    requirePermission(ctx, "CASHIERING", "create");

    const { id: folioId } = await params;
    const body = await request.json();

    if (!body.chargeCodeId || !body.amount || !body.description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Check if folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId },
      include: { reservation: { include: { property: true } } }
    });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.reservation.propertyId);
    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot post charges to a closed folio" }, { status: 400 });
    }

    const chargeCode = await prisma.chargeCode.findUnique({ where: { id: body.chargeCodeId } });
    if (!chargeCode || chargeCode.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge code not found" }, { status: 404 });
    }

    // Fetch Enterprise Settings for Tax calculation, derived from the folio's own
    // reservation → property → enterprise (not a hardcoded constant).
    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: folio.reservation.property.enterpriseId }
    });

    const inputAmount = parseFloat(body.amount);
    let baseAmount = inputAmount;
    let serviceChargeAmount = 0.0;
    let calculatedTaxAmount = 0.0;

    if (settings) {
      const serviceRate = settings.serviceChargeEnabled ? (settings.serviceChargeRate / 100) : 0.0;
      const tgstRateFraction = settings.tgstEnabled ? (settings.tgstRate / 100) : 0.0;

      if (folio.reservation.property.pricesIncludeTaxes) {
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
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
