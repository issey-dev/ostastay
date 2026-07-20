import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveChargeTax } from "@/lib/tax-calc";
import { logActivity } from "@/lib/activity-log";

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
    const inputAmount = Number(body.amount);
    if (!Number.isFinite(inputAmount) || inputAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }

    // Check if folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId },
      include: { property: true }
    });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);
    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot post charges to a closed folio" }, { status: 400 });
    }

    const chargeCode = await prisma.chargeCode.findUnique({
      where: { id: body.chargeCodeId },
      include: { taxProfile: { include: { rates: true } } }
    });
    if (!chargeCode || chargeCode.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge code not found" }, { status: 404 });
    }

    // Fetch Enterprise Settings for Tax calculation, derived from the folio's own
    // property → enterprise (not a hardcoded constant).
    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: folio.property.enterpriseId }
    });

    const { baseAmount, taxAmount, serviceChargeAmount } = resolveChargeTax({
      chargeCode,
      inputAmount,
      settings,
      pricesIncludeTaxes: folio.property.pricesIncludeTaxes
    });

    const lineItem = await prisma.folioLineItem.create({
      data: {
        folioId,
        chargeCodeId: body.chargeCodeId,
        date: new Date(),
        description: body.description,
        amount: baseAmount,
        taxAmount,
        serviceChargeAmount,
      },
      include: {
        chargeCode: true
      }
    });

    await logActivity({
      ctx,
      module: "CASHIERING",
      action: "CREATE",
      entityType: "FolioLineItem",
      entityId: lineItem.id,
      description: `Posted charge "${body.description}" (${chargeCode.code}, $${(baseAmount + taxAmount + serviceChargeAmount).toFixed(2)}) to folio #${folio.folioNumber}`,
    });

    return NextResponse.json(lineItem, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
