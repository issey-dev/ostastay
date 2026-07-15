import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")
    const floorId = searchParams.get("floorId")

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }

    const whereClause: any = { propertyId }
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
    console.error("Error fetching rooms for housekeeping:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

// Update room status(es)
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { roomId, roomIds, status, assignedAttendantId } = body

    if (!roomId && (!roomIds || roomIds.length === 0)) {
      return NextResponse.json({ error: "roomId or roomIds are required" }, { status: 400 })
    }

    const dataToUpdate: any = {}
    if (status !== undefined) dataToUpdate.status = status
    if (assignedAttendantId !== undefined) {
      dataToUpdate.assignedAttendantId = assignedAttendantId === null ? null : assignedAttendantId
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    if (roomIds && roomIds.length > 0) {
      // Bulk update
      const result = await prisma.room.updateMany({
        where: { id: { in: roomIds } },
        data: dataToUpdate
      })
      return NextResponse.json({ success: true, count: result.count })
    } else {
      // Single update
      const updatedRoom = await prisma.room.update({
        where: { id: roomId },
        data: dataToUpdate
      })
      return NextResponse.json(updatedRoom)
    }
  } catch (error) {
    console.error("Error updating room:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
