import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { resolveChargeTax } from "@/lib/tax-calc"

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "NIGHT_AUDIT", "create")

    const { propertyId } = await request.json()

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    const property = await prisma.property.findUnique({ where: { id: propertyId } })
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 })
    }

    // Who ran the audit is derived from the session, never a client-supplied string.
    const runByUser = await prisma.user.findUnique({ where: { id: ctx.userId } })
    const executedBy = runByUser ? `${runByUser.firstName} ${runByUser.lastName}` : ctx.userId

    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: property.enterpriseId }
    })

    // Ensure we have a ROOM charge code to post nightly room revenue against
    const roomCode = await prisma.chargeCode.findFirst({
      where: { enterpriseId: property.enterpriseId, code: "ROOM" },
      include: { taxProfile: { include: { rates: true } } }
    })

    if (!roomCode) {
      return NextResponse.json({ error: "Missing ROOM charge code in system settings." }, { status: 400 })
    }

    // Green Tax (Maldives): a flat per-adult/per-child nightly government levy, separate
    // from GST/service charge and unaffected by the property's tax-inclusive toggle.
    // Infants (Reservation.infants) are exempt and not counted. Only require the GTX
    // charge code to exist when Green Tax is actually enabled for this enterprise.
    const greenTaxEnabled = settings?.greenTaxEnabled ?? false
    let gtxCode = null
    if (greenTaxEnabled) {
      gtxCode = await prisma.chargeCode.findFirst({
        where: { enterpriseId: property.enterpriseId, code: "GTX" }
      })
      if (!gtxCode) {
        return NextResponse.json({ error: "Missing GTX charge code in system settings." }, { status: 400 })
      }
    }

    // 1. Fetch all currently checked-in reservations
    const activeReservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: "IN_HOUSE"
      },
      include: {
        folios: {
          where: { isClosed: false }
        },
        assignments: {
          orderBy: { startDate: 'desc' },
          include: { roomType: true }
        }
      }
    })

    if (activeReservations.length === 0) {
      // Nothing to process, but we still log an empty audit
      const log = await prisma.propertyNightAuditLog.create({
        data: {
          propertyId,
          auditDate: new Date(),
          executedBy,
          roomsOccupied: 0,
          roomRevenue: 0,
          taxPosted: 0,
          totalPostings: 0,
          status: "COMPLETED"
        }
      })
      return NextResponse.json({ success: true, log })
    }

    const today = new Date()
    const pricesIncludeTaxes = property.pricesIncludeTaxes

    let totalRoomRevenue = 0
    let totalTaxPosted = 0
    let totalPostings = 0

    // 2. Loop through reservations and post the nightly room charge
    for (const res of activeReservations) {
      if (res.folios.length === 0) continue

      const activeAssignment = res.assignments[0]
      if (!activeAssignment) continue

      // Always posts to the reservation's own folio, regardless of settlement method —
      // City Ledger reservations accumulate charges on their own folio exactly like
      // any other stay; the transfer to a debtor account only happens at checkout
      // (see reservations/[id]/check-out/route.ts), not here. Debtors intentionally
      // never sees anything from an in-house reservation.
      const targetFolioId = res.folios[0].id

      let inputAmount = activeAssignment.overrideRate
      if (inputAmount == null) {
        const calendarEntry = await prisma.priceCalendar.findFirst({
          where: {
            ratePlanId: activeAssignment.ratePlanId,
            roomTypeId: activeAssignment.roomTypeId,
            date: {
              gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
              lt: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
            }
          }
        })
        inputAmount = calendarEntry?.price ?? activeAssignment.roomType.basePrice
      }

      const { baseAmount, taxAmount, serviceChargeAmount } = resolveChargeTax({
        chargeCode: roomCode,
        inputAmount,
        settings,
        pricesIncludeTaxes
      })

      await prisma.folioLineItem.create({
        data: {
          folioId: targetFolioId,
          chargeCodeId: roomCode.id,
          amount: baseAmount,
          taxAmount,
          serviceChargeAmount,
          description: "Nightly Room Charge",
          date: today
        }
      })

      totalRoomRevenue += baseAmount
      totalTaxPosted += taxAmount + serviceChargeAmount
      totalPostings += 1

      // 2b. Post nightly Green Tax — flat per adult/child, infants exempt.
      if (greenTaxEnabled && gtxCode) {
        const greenTaxAmount = Math.round(
          (res.adults * (settings!.greenTaxAdultAmount) + res.children * (settings!.greenTaxChildAmount)) * 100
        ) / 100

        if (greenTaxAmount > 0) {
          await prisma.folioLineItem.create({
            data: {
              folioId: targetFolioId,
              chargeCodeId: gtxCode.id,
              amount: greenTaxAmount,
              taxAmount: 0,
              serviceChargeAmount: 0,
              description: "Green Tax",
              date: today
            }
          })

          totalTaxPosted += greenTaxAmount
          totalPostings += 1
        }
      }
    }

    // 3. Log the audit run
    const log = await prisma.propertyNightAuditLog.create({
      data: {
        propertyId,
        auditDate: today,
        executedBy,
        roomsOccupied: activeReservations.length,
        roomRevenue: totalRoomRevenue,
        taxPosted: totalTaxPosted,
        totalPostings,
        status: "COMPLETED"
      }
    })

    return NextResponse.json({ success: true, log })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
