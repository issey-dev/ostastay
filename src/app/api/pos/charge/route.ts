import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { postCharge } from "@/lib/posting/post-charge"
import { resolveBusinessDate } from "@/lib/business-date"
import { resolveRoutingTargetFolioId } from "@/lib/folio-routing"
import { ensureOpenShift } from "@/lib/cashier-shift"
import { allocateOutletCheckNumber } from "@/lib/document-sequence"
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

    // Resolve the outlet sales check this charge belongs to (only when posting through an
    // outlet). A walk-in bill is 1:1 with a check and carries a single outlet; room posts
    // reuse the check id the client holds for the session, or open a fresh one. The actual
    // number allocation + OutletCheck insert happen inside the transaction below.
    let existingOutletCheckId: string | null = null
    let checkToCreateFolioId: string | null | undefined = undefined // undefined = don't create
    if (outlet) {
      const requestedCheckId = typeof body.outletCheckId === "string" ? body.outletCheckId : null
      if (requestedCheckId) {
        const check = await prisma.outletCheck.findUnique({ where: { id: requestedCheckId } })
        if (!check || check.outletId !== outlet.id || check.propertyId !== folio.propertyId) {
          return NextResponse.json({ error: "Outlet check not found for this outlet" }, { status: 404 })
        }
        if (check.isClosed) {
          return NextResponse.json({ error: "This outlet check is already closed" }, { status: 400 })
        }
        existingOutletCheckId = check.id
      } else if (!folio.reservationId) {
        // Walk-in bill: at most one check, and it may only carry one outlet.
        const existing = await prisma.outletCheck.findFirst({ where: { folioId: folio.id } })
        if (existing) {
          if (existing.outletId !== outlet.id) {
            return NextResponse.json({ error: "A walk-in bill can only carry charges from one outlet" }, { status: 400 })
          }
          existingOutletCheckId = existing.id
        } else {
          checkToCreateFolioId = folio.id
        }
      } else {
        // Charge posted onto an in-house room folio — the check groups the session but is
        // not tied to the guest's folio (that stays the guest-house bill).
        checkToCreateFolioId = null
      }
    }

    // Fetch Enterprise Settings for Tax calculation, derived from the folio's own
    // property → enterprise (not a hardcoded constant) — works the same whether the
    // folio is reservation-backed or a walk-in.
    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: folio.property.enterpriseId }
    });

    const lineDescription = (typeof description === "string" && description.trim()) ? description.trim() : chargeCode.description
    // Reference is now its own field (was concatenated into the description before).
    const lineReference = typeof reference === "string" && reference.trim() ? reference.trim() : null

    const targetFolioId = folio.reservationId
      ? await resolveRoutingTargetFolioId(folio.reservationId, chargeCodeId, folioId)
      : folioId

    // Attribute to the caller's open drawer for the folio's property (auto-open if needed).
    const shift = await ensureOpenShift(ctx, folio.propertyId)

    const { lineItem, baseAmount, taxAmount, serviceChargeAmount } = await prisma.$transaction(async (tx) => {
      let outletCheckId = existingOutletCheckId
      if (outlet && checkToCreateFolioId !== undefined) {
        const checkNumber = await allocateOutletCheckNumber(outlet.id, tx)
        const created = await tx.outletCheck.create({
          data: {
            outletId: outlet.id,
            propertyId: folio.propertyId,
            folioId: checkToCreateFolioId,
            checkNumber,
          },
        })
        outletCheckId = created.id
      }

      // Posts through the one posting service — which still applies the outlet's tax
      // override via resolveOutletChargeTax, and additionally fires any generate rows
      // the code declares (a levy on a POS item, e.g. a bed tax on a package sale).
      const posted = await postCharge(tx, {
        folioId: targetFolioId,
        chargeCode,
        inputAmount: chargeAmount,
        settings,
        pricesIncludeTaxes: folio.property.pricesIncludeTaxes,
        date: resolveBusinessDate(folio.property),
        description: lineDescription,
        reference: lineReference,
        outlet,
        outletId: outletId || null,
        outletCheckId,
        shiftId: shift.id,
      })

      return {
        lineItem: await tx.folioLineItem.findUniqueOrThrow({
          where: { id: posted.parent.id },
          include: {
            chargeCode: true,
            outletCheck: { select: { id: true, checkNumber: true } },
          },
        }),
        baseAmount: posted.baseAmount,
        taxAmount: posted.parent.taxAmount,
        serviceChargeAmount: posted.parent.serviceChargeAmount,
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
