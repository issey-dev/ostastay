import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { startOfDay, endOfDay } from "date-fns"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { LINE_BUCKET_INCLUDE, lineReportBucket } from "@/lib/posting/report-bucket"

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "REVENUE", "view")

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")

    // Default to today for "Flash Report"
    const dateParam = searchParams.get("date")
    const targetDate = dateParam ? new Date(dateParam) : new Date()

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    const start = startOfDay(targetDate)
    const end = endOfDay(targetDate)

    // 1. Total Physical Rooms
    const totalRooms = await prisma.room.count({
      where: { propertyId }
    })

    // 2. Occupied Rooms (Reservations that intersect with today)
    const occupiedReservations = await prisma.reservation.findMany({
      where: {
        propertyId,
        status: { in: ["RESERVED", "IN_HOUSE"] },
        checkInDate: { lte: end },
        checkOutDate: { gt: start }
      }
    })

    const occupiedRoomsCount = occupiedReservations.length
    const occupancyPercentage = totalRooms > 0 ? (occupiedRoomsCount / totalRooms) * 100 : 0

    // 3. Revenue Data (Folio Line Items for today)
    const todayLineItems = await prisma.folioLineItem.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        folio: {
          reservation: { propertyId }
        }
      },
      include: LINE_BUCKET_INCLUDE
    })

    // Aggregate Room Revenue vs Other Revenue
    let roomRevenue = 0
    let otherRevenue = 0
    let totalRevenue = 0

    const revenueByCategory: Record<string, number> = {}

    todayLineItems.forEach(item => {
      const amount = item.amount
      totalRevenue += amount

      // Was `item.chargeCode?.code` — a variable named `category` that actually held the
      // CODE, so `revenueByCategory` was keyed by code while every other report keyed by
      // category, and room revenue only worked by the accident that the code string
      // happened to be "ROOM". Now the real reporting bucket, same as everywhere else.
      const bucket = lineReportBucket(item)

      if (bucket === "ROOM") {
        roomRevenue += amount
      } else {
        otherRevenue += amount
      }

      if (!revenueByCategory[bucket]) revenueByCategory[bucket] = 0
      revenueByCategory[bucket] += amount
    })

    // 4. Calculate KPIs
    const adr = occupiedRoomsCount > 0 ? roomRevenue / occupiedRoomsCount : 0
    const revpar = totalRooms > 0 ? roomRevenue / totalRooms : 0

    return NextResponse.json({
      date: targetDate,
      totalRooms,
      occupiedRoomsCount,
      occupancyPercentage,
      roomRevenue,
      otherRevenue,
      totalRevenue,
      adr,
      revpar,
      revenueByCategory,
      recentActivityCount: todayLineItems.length
    })

  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
