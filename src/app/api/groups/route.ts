import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

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
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "GROUP_BLOCKS", "create")

    const body = await request.json()
    const { propertyId, code, name, startDate, endDate, cutoffDate, totalRoomsHeld } = body

    if (!propertyId || !code || !name || !startDate || !endDate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

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
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
