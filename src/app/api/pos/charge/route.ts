import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { resolveOutletChargeTax } from "@/lib/tax-calc"
import { resolveBusinessDate } from "@/lib/business-date"
import { resolveRoutingTargetFolioId } from "@/lib/folio-routing"
import { ensureOpenShift } from "@/lib/cashier-shift"
import { logActivity } from "@/lib/activity-log"

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "POS", "create")

    const body = await request.json()
    const { folioId, amount, chargeCodeId, description, reference, outletId } = body

    if (!folioId || amount === undefined || amount === null || amount === "" || !chargeCodeId) {
      return NextResponse.json({ error: "Folio, charge code, and amount are required" }, { status: 400 })
    }
    // Negative amounts allowed (adjustments/reversals); reject only zero/non-numeric.
    const chargeAmount = Number(amount)
    if (!Number.isFinite(chargeAmount) || chargeAmount === 0) {
      return NextResponse.json({ error: "Amount must be a non-zero number" }, { status: 400 })
    }

    // Verify folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId },
      include: { property: true, reservation: { select: { status: true } } }
    })

    if (!folio) return NextResponse.json({ error: "Folio not found" }, { status: 404 })
    await assertPropertyAccess(ctx, folio.propertyId)
    if (folio.isClosed) return NextResponse.json({ error: "Cannot post charges to a closed folio" }, { status: 400 })
    // Reservation folios accept charges only once the guest is checked in (a
    // deliberate pre-arrival fee opts in with preArrivalFee:true); walk-in outlet
    // folios (no reservation) are always billable.
    if (folio.reservation && folio.reservation.status !== "IN_HOUSE" && body.preArrivalFee !== true) {
      return NextResponse.json({ error: "Charges can only be posted after check-in. (For a cancellation/no-show fee, use the pre-arrival fee action.)" }, { status: 400 })
    }

    const chargeCode = await prisma.chargeCode.findUnique({
      where: { id: chargeCodeId },
      include: { taxProfile: { include: { rates: true } } }
    })
    if (!chargeCode || chargeCode.enterpriseId !== ctx.enterpriseId) {
      return NextResponse.json({ error: "Charge code not found" }, { status: 404 })
    }

    // An Outlet selection is optional context on top of the ordinary charge flow — it
    // scopes which codes are offered (validated below), attributes the resulting
    // revenue, and can override the charge code's own tax handling (resolveOutletChargeTax).
    let outlet = null
    if (outletId) {
      outlet = await prisma.outlet.findUnique({
        where: { id: outletId },
        include: { taxProfile: { include: { rates: true } } }
      })
      if (!outlet) return NextResponse.json({ error: "Outlet not found" }, { status: 404 })
      await assertPropertyAccess(ctx, outlet.propertyId)
      if (outlet.propertyId !== folio.propertyId) {
        return NextResponse.json({ error: "Outlet does not belong to this folio's property" }, { status: 400 })
      }

      const isInOutletPool = await prisma.outletChargeCode.findUnique({
        where: { outletId_chargeCodeId: { outletId, chargeCodeId } }
      })
      if (!isInOutletPool) {
        return NextResponse.json({ error: "This charge code is not offered by the selected outlet" }, { status: 400 })
      }
    }

    // Fetch Enterprise Settings for Tax calculation, derived from the folio's own
    // property → enterprise (not a hardcoded constant) — works the same whether the
    // folio is reservation-backed or a walk-in.
    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: folio.property.enterpriseId }
    });

    const { baseAmount, taxAmount, serviceChargeAmount } = resolveOutletChargeTax({
      chargeCode,
      outlet,
      inputAmount: chargeAmount,
      settings,
      pricesIncludeTaxes: folio.property.pricesIncludeTaxes
    })

    const lineDescription = (typeof description === "string" && description.trim()) ? description.trim() : chargeCode.description
    // Reference is now its own field (was concatenated into the description before).
    const lineReference = typeof reference === "string" && reference.trim() ? reference.trim() : null

    const targetFolioId = folio.reservationId
      ? await resolveRoutingTargetFolioId(folio.reservationId, chargeCodeId, folioId)
      : folioId

    // Attribute to the caller's open drawer for the folio's property (auto-open if needed).
    const shift = await ensureOpenShift(ctx, folio.propertyId)

    const lineItem = await prisma.folioLineItem.create({
      data: {
        folioId: targetFolioId,
        chargeCodeId,
        outletId: outletId || null,
        shiftId: shift.id,
        amount: baseAmount,
        taxAmount,
        serviceChargeAmount,
        description: lineDescription,
        reference: lineReference,
        date: resolveBusinessDate(folio.property)
      },
      include: {
        chargeCode: true
      }
    })

    await logActivity({
      ctx,
      module: "POS",
      action: "CREATE",
      entityType: "FolioLineItem",
      entityId: lineItem.id,
      description: `POS charge "${lineDescription}" (${chargeCode.code}, $${(baseAmount + taxAmount + serviceChargeAmount).toFixed(2)})${outlet ? ` via ${outlet.name}` : ""}`,
    })

    return NextResponse.json(lineItem)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
