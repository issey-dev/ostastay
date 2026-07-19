import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "HOUSEKEEPING", "view")

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")
    const floorId = searchParams.get("floorId")

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    // Pseudo/virtual rooms have no floor at all, so they never belong on the
    // housekeeping board. Rooms whose room type has housekeepingEnabled off (the
    // deliberate "this room type shouldn't offer housekeeping workflows" toggle) are
    // excluded from the board the same way.
    const whereClause: any = {
      propertyId,
      floorId: { not: null },
      roomType: { housekeepingEnabled: true }
    }
    if (floorId) {
      whereClause.floorId = floorId
    }

    const rooms = await prisma.room.findMany({
      where: whereClause,
      include: {
        roomType: true,
        floor: true,
        assignedAttendant: true,
        maintenance: {
          where: {
            status: {
              in: ["OPEN", "IN_PROGRESS"]
            }
          },
          include: {
            assignedTo: true
          }
        },
        housekeepingTasks: {
          where: {
            status: {
              not: "COMPLETED"
            }
          },
          include: {
            assignedTo: {
              include: {
                user: true
              }
            }
          }
        },
        RoomAssignment: {
          where: {
            startDate: { lte: new Date() },
            endDate: { gte: new Date() }
          },
          include: {
            reservation: true
          }
        }
      },
      orderBy: [
        { floor: { name: 'asc' } },
        { roomNumber: 'asc' }
      ]
    })

    return NextResponse.json(rooms)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

// Update room status(es)
export async function PATCH(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "HOUSEKEEPING", "update")

    const body = await request.json()
    const { roomId, roomIds, status, assignedAttendantId } = body

    if (!roomId && (!roomIds || roomIds.length === 0)) {
      return NextResponse.json({ error: "roomId or roomIds are required" }, { status: 400 })
    }

    const dataToUpdate: any = {}
    if (status !== undefined) dataToUpdate.status = status
    if (assignedAttendantId !== undefined) {
      if (assignedAttendantId !== null) {
        const attendant = await prisma.user.findUnique({ where: { id: assignedAttendantId } })
        if (!attendant || attendant.enterpriseId !== ctx.enterpriseId) {
          return NextResponse.json({ error: "Attendant not found" }, { status: 404 })
        }
      }
      dataToUpdate.assignedAttendantId = assignedAttendantId
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    if (roomIds && roomIds.length > 0) {
      // Bulk update — confirm every targeted room belongs to a property this actor can
      // reach before touching any of them (a guessed id from another enterprise/property
      // must not be silently included).
      const rooms = await prisma.room.findMany({ where: { id: { in: roomIds } } })
      const distinctPropertyIds = [...new Set(rooms.map((r) => r.propertyId))]
      for (const propertyId of distinctPropertyIds) {
        await assertPropertyAccess(ctx, propertyId)
      }

      const result = await prisma.room.updateMany({
        where: { id: { in: rooms.map((r) => r.id) } },
        data: dataToUpdate
      })
      return NextResponse.json({ success: true, count: result.count })
    } else {
      const existing = await prisma.room.findUnique({ where: { id: roomId } })
      if (!existing) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 })
      }
      await assertPropertyAccess(ctx, existing.propertyId)

      const updatedRoom = await prisma.room.update({
        where: { id: roomId },
        data: dataToUpdate
      })
      return NextResponse.json(updatedRoom)
    }
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
