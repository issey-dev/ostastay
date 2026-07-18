import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const { propertyId, executedBy } = await request.json()

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID required" }, { status: 400 })
    }

    const property = await prisma.property.findUnique({ where: { id: propertyId } })
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 })
    }

    const settings = await prisma.enterpriseSettings.findUnique({
      where: { enterpriseId: property.enterpriseId }
    })

    // Ensure we have a ROOM charge code to post nightly room revenue against
    const roomCode = await prisma.chargeCode.findFirst({
      where: { enterpriseId: property.enterpriseId, code: "ROOM" }
    })

    if (!roomCode) {
      return NextResponse.json({ error: "Missing ROOM charge code in system settings." }, { status: 400 })
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
          executedBy: executedBy || "System",
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
    const serviceRate = settings?.serviceChargeEnabled ? (settings.serviceChargeRate / 100) : 0.0
    const tgstRateFraction = settings?.tgstEnabled ? (settings.tgstRate / 100) : 0.0
    const pricesIncludeTaxes = property.pricesIncludeTaxes

    let totalRoomRevenue = 0
    let totalTaxPosted = 0
    let totalPostings = 0

    // 2. Loop through reservations and post the nightly room charge
    for (const res of activeReservations) {
      if (res.folios.length === 0) continue

      const activeAssignment = res.assignments[0]
      if (!activeAssignment) continue

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

      let baseAmount = inputAmount
      let serviceChargeAmount = 0.0
      let taxAmount = 0.0

      if (pricesIncludeTaxes) {
        baseAmount = inputAmount / ((1 + serviceRate) * (1 + tgstRateFraction))
        serviceChargeAmount = baseAmount * serviceRate
        taxAmount = (baseAmount + serviceChargeAmount) * tgstRateFraction
      } else {
        serviceChargeAmount = baseAmount * serviceRate
        taxAmount = (baseAmount + serviceChargeAmount) * tgstRateFraction
      }

      baseAmount = Math.round(baseAmount * 100) / 100
      serviceChargeAmount = Math.round(serviceChargeAmount * 100) / 100
      taxAmount = Math.round(taxAmount * 100) / 100

      const folioId = res.folios[0].id

      await prisma.folioLineItem.create({
        data: {
          folioId,
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
    }

    // 3. Log the audit run
    const log = await prisma.propertyNightAuditLog.create({
      data: {
        propertyId,
        auditDate: today,
        executedBy: executedBy || "System",
        roomsOccupied: activeReservations.length,
        roomRevenue: totalRoomRevenue,
        taxPosted: totalTaxPosted,
        totalPostings,
        status: "COMPLETED"
      }
    })

    return NextResponse.json({ success: true, log })
  } catch (error) {
    console.error("Night Audit Error:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
