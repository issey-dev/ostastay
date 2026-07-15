import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"
import { startOfDay, endOfDay } from "date-fns"

const prisma = new PrismaClient()

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")
    
    // Default to today for "Flash Report"
    const dateParam = searchParams.get("date")
    const targetDate = dateParam ? new Date(dateParam) : new Date()
    
    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }

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
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
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
      include: { chargeCode: true }
    })

    // Aggregate Room Revenue vs Other Revenue
    let roomRevenue = 0
    let otherRevenue = 0
    let totalRevenue = 0
    
    const revenueByCategory: Record<string, number> = {}

    todayLineItems.forEach(item => {
      const amount = item.amount
      totalRevenue += amount

      const category = item.chargeCode?.code || "OTHER"
      
      if (category === "ROOM") {
        roomRevenue += amount
      } else {
        otherRevenue += amount
      }

      if (!revenueByCategory[category]) revenueByCategory[category] = 0
      revenueByCategory[category] += amount
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
    console.error("Error generating analytics:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
