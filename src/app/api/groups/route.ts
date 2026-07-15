import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }

    const groups = await prisma.groupBlock.findMany({
      where: { propertyId },
      include: {
        reservations: true,
        masterFolios: true
      },
      orderBy: { startDate: 'asc' }
    })

    return NextResponse.json(groups)
  } catch (error) {
    console.error("Error fetching groups:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { propertyId, code, name, startDate, endDate, cutoffDate, totalRoomsHeld } = body

    if (!propertyId || !code || !name || !startDate || !endDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Check if group code exists
    const existing = await prisma.groupBlock.findUnique({
      where: { code }
    })
    
    if (existing) {
      return NextResponse.json({ error: "Group code already exists" }, { status: 400 })
    }

    const newGroup = await prisma.groupBlock.create({
      data: {
        propertyId,
        code,
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        cutoffDate: cutoffDate ? new Date(cutoffDate) : null,
        totalRoomsHeld: parseInt(totalRoomsHeld) || 0,
        status: "TENTATIVE"
      }
    })

    return NextResponse.json(newGroup)
  } catch (error) {
    console.error("Error creating group:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
