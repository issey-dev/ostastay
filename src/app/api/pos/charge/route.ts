import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { resolveOutletChargeTax } from "@/lib/tax-calc"
import { logActivity } from "@/lib/activity-log"

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "POS", "create")

    const body = await request.json()
    const { folioId, amount, chargeCodeId, description, reference, outletId } = body

    if (!folioId || !amount || !chargeCodeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    const chargeAmount = Number(amount)
    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 })
    }

    // Verify folio exists and is open
    const folio = await prisma.folio.findUnique({
      where: { id: folioId },
      include: { property: true }
    })

    if (!folio) return NextResponse.json({ error: "Folio not found" }, { status: 404 })
    await assertPropertyAccess(ctx, folio.propertyId)
    if (folio.isClosed) return NextResponse.json({ error: "Cannot post charges to a closed folio" }, { status: 400 })

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

    const lineItem = await prisma.folioLineItem.create({
      data: {
        folioId,
        chargeCodeId,
        outletId: outletId || null,
        amount: baseAmount,
        taxAmount,
        serviceChargeAmount,
        description: (description || "POS Charge") + (reference ? ` | Ref: ${reference}` : ""),
        date: new Date()
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
      description: `POS charge "${description || "POS Charge"}" (${chargeCode.code}, $${(baseAmount + taxAmount + serviceChargeAmount).toFixed(2)})${outlet ? ` via ${outlet.name}` : ""}`,
    })

    return NextResponse.json(lineItem)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
