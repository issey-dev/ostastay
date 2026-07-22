import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope";
import { resolveChargeTax } from "@/lib/tax-calc";
import { resolveBusinessDate } from "@/lib/business-date";
import { resolveRoutingTargetFolioId } from "@/lib/folio-routing";
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

    if (!body.chargeCodeId || body.amount === undefined || body.amount === null || body.amount === "") {
      return NextResponse.json({ error: "Charge code and amount are required" }, { status: 400 });
    }
    // Negative amounts are allowed (adjustments/reversals); only zero and
    // non-numeric are rejected.
    const inputAmount = Number(body.amount);
    if (!Number.isFinite(inputAmount) || inputAmount === 0) {
      return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 });
    }

    // Check if folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId },
      include: { property: true, reservation: { select: { status: true } } }
    });
    if (!folio) {
      return NextResponse.json({ error: "Folio not found" }, { status: 404 });
    }
    await assertPropertyAccess(ctx, folio.propertyId);
    if (folio.isClosed) {
      return NextResponse.json({ error: "Cannot post charges to a closed folio" }, { status: 400 });
    }
    // Billing a reservation folio is only allowed once the guest is checked in.
    // (Deposits before arrival go through the payments route, not charges.) The one
    // exception is a deliberate pre-arrival fee — a cancellation or no-show fee is
    // posted to a still-RESERVED/NO_SHOW booking — which the caller must opt into
    // with preArrivalFee:true. Walk-in / outlet folios have no reservation and are
    // always billable.
    if (folio.reservation && folio.reservation.status !== "IN_HOUSE" && body.preArrivalFee !== true) {
      return NextResponse.json(
        { error: "Charges can only be posted after check-in. (For a cancellation/no-show fee, use the pre-arrival fee action.)" },
        { status: 400 }
      );
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

    // Description defaults to the charge code's own description; Reference is
    // separate free text printed on the invoice.
    const description = (typeof body.description === "string" && body.description.trim())
      ? body.description.trim()
      : chargeCode.description;
    const reference = typeof body.reference === "string" && body.reference.trim() ? body.reference.trim() : null;

    // A standing routing rule may redirect this charge to another folio window /
    // room (see FolioRoutingRule). Only reservation-backed folios can be routed from.
    const targetFolioId = folio.reservationId
      ? await resolveRoutingTargetFolioId(folio.reservationId, body.chargeCodeId, folioId)
      : folioId;

    const lineItem = await prisma.folioLineItem.create({
      data: {
        folioId: targetFolioId,
        chargeCodeId: body.chargeCodeId,
        date: resolveBusinessDate(folio.property),
        description,
        reference,
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
      description: `Posted charge "${description}" (${chargeCode.code}, $${(baseAmount + taxAmount + serviceChargeAmount).toFixed(2)}) to folio #${folio.folioNumber}` +
        (targetFolioId !== folioId ? " (auto-routed)" : ""),
    });

    return NextResponse.json(lineItem, { status: 201 });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
