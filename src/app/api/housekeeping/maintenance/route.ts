import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "MAINTENANCE", "create")

    const body = await request.json()
    const { roomIds, issueType, description, reportedBy, priority, takeOutOfOrder, expectedReturn } = body

    if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return NextResponse.json({ error: "An array of roomIds is required" }, { status: 400 })
    }

    if (!issueType || !description) {
      return NextResponse.json({ error: "issueType and description are required" }, { status: 400 })
    }
    if (priority !== undefined && !["LOW", "MEDIUM", "HIGH"].includes(priority)) {
      return NextResponse.json({ error: "priority must be LOW, MEDIUM, or HIGH" }, { status: 400 })
    }

    // Confirm every targeted room belongs to a property this actor can reach before
    // touching any of them — a guessed id from another enterprise/property must not be
    // silently included.
    const rooms = await prisma.room.findMany({ where: { id: { in: roomIds } }, include: { roomType: true } })
    const distinctPropertyIds = [...new Set(rooms.map((r) => r.propertyId))]
    for (const propertyId of distinctPropertyIds) {
      await assertPropertyAccess(ctx, propertyId)
    }
    if (rooms.some((r) => !r.roomType.housekeepingEnabled)) {
      return NextResponse.json({ error: "One or more rooms belong to a room type that does not offer housekeeping" }, { status: 400 })
    }

    const dataToInsert = rooms.map((room) => ({
      roomId: room.id,
      issueType,
      description,
      reportedBy: reportedBy || "Housekeeping",
      status: "OPEN",
      priority: priority || "MEDIUM"
    }))

    const result = await prisma.roomMaintenance.createMany({
      data: dataToInsert
    })

    // Optionally pull the reported rooms from inventory in the same action.
    if (takeOutOfOrder) {
      await prisma.room.updateMany({
        where: { id: { in: rooms.map((r) => r.id) } },
        data: {
          status: "OUT_OF_ORDER",
          oooReason: description,
          oooExpectedReturn: expectedReturn ? new Date(expectedReturn) : null,
        },
      })
    }

    await logActivity({
      ctx,
      module: "MAINTENANCE",
      action: "CREATE",
      entityType: "RoomMaintenance",
      description: `Reported ${issueType} issue for room(s) ${rooms.map((r) => r.roomNumber).join(", ")}: ${description}`,
    })

    return NextResponse.json({ success: true, count: result.count })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
