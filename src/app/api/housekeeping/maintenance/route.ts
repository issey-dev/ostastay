import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { roomIds, issueType, description, reportedBy } = body

    if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return NextResponse.json({ error: "An array of roomIds is required" }, { status: 400 })
    }

    if (!issueType || !description) {
      return NextResponse.json({ error: "issueType and description are required" }, { status: 400 })
    }

    // Bulk create maintenance notes
    const dataToInsert = roomIds.map(roomId => ({
      roomId,
      issueType,
      description,
      reportedBy: reportedBy || "Housekeeping",
      status: "OPEN",
      priority: "MEDIUM"
    }))

    const result = await prisma.roomMaintenance.createMany({
      data: dataToInsert
    })

    return NextResponse.json({ success: true, count: result.count })
  } catch (error) {
    console.error("Error creating maintenance tickets:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
