import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { resolveBusinessDate } from "@/lib/business-date"
import { logActivity } from "@/lib/activity-log"

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

    // Occupancy is anchored to the property's BUSINESS DATE (the operational "today"),
    // not the wall clock — the whole PMS runs on business date, and a property whose
    // audit hasn't rolled to real time would otherwise show every in-house guest as
    // vacant (their stay looks "in the past" against new Date()).
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { businessDate: true } })
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 })
    }
    const businessDate = resolveBusinessDate(property)

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
            startDate: { lte: businessDate },
            endDate: { gte: businessDate },
            // Only live stays: a CHECKED_OUT/CANCELLED/NO_SHOW reservation's
            // assignment still spans today but the room is not occupied by it.
            // RESERVED is included so the board can flag today's arrivals.
            reservation: { status: { in: ["RESERVED", "IN_HOUSE"] } }
          },
          include: {
            reservation: {
              include: {
                // The board card shows the occupant's name, headcount, and a sharer
                // badge — a bare `reservation: true` never carried these.
                primaryGuest: { select: { firstName: true, lastName: true } },
                accompanyingGuests: { select: { id: true } },
              },
            },
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
    const { roomId, roomIds, status, assignedAttendantId, oooReason, oooExpectedReturn } = body

    if (!roomId && (!roomIds || roomIds.length === 0)) {
      return NextResponse.json({ error: "roomId or roomIds are required" }, { status: 400 })
    }

    const VALID_ROOM_STATUSES = ["CLEAN", "DIRTY", "INSPECTED", "OUT_OF_ORDER", "OUT_OF_SERVICE"]
    if (status !== undefined && !VALID_ROOM_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid room status — expected one of ${VALID_ROOM_STATUSES.join(", ")}` }, { status: 400 })
    }

    const dataToUpdate: any = {}
    if (status !== undefined) dataToUpdate.status = status
    // OOO metadata rides along only while a room is going out of order/service;
    // any return to a sellable status clears it so stale reasons can't linger.
    if (status === "OUT_OF_ORDER" || status === "OUT_OF_SERVICE") {
      if (oooReason !== undefined) dataToUpdate.oooReason = oooReason || null
      if (oooExpectedReturn !== undefined) {
        dataToUpdate.oooExpectedReturn = oooExpectedReturn ? new Date(oooExpectedReturn) : null
      }
    } else if (status !== undefined) {
      dataToUpdate.oooReason = null
      dataToUpdate.oooExpectedReturn = null
    }
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

    const changeDesc = [
      status !== undefined ? `status → ${status}` : null,
      assignedAttendantId !== undefined ? (assignedAttendantId ? "attendant assigned" : "attendant cleared") : null,
    ].filter(Boolean).join(", ")

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
      // Marking rooms clean/inspected completes their open cleaning work — the
      // departure-clean task and the room status are one lifecycle, not two.
      if (status === "CLEAN" || status === "INSPECTED") {
        await prisma.housekeepingTask.updateMany({
          where: { roomId: { in: rooms.map((r) => r.id) }, taskType: { not: "SPECIAL_REQUEST" }, status: { not: "COMPLETED" } },
          data: { status: "COMPLETED", completedAt: new Date() },
        })
      }
      await logActivity({
        ctx,
        module: "HOUSEKEEPING",
        action: "UPDATE",
        entityType: "Room",
        description: `Bulk room update (${result.count} room${result.count === 1 ? "" : "s"}): ${changeDesc}`,
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
      // Same coupling as the bulk path: a clean/inspected room has no open
      // cleaning tasks left (special requests stay — they're guest asks, not cleans).
      if (status === "CLEAN" || status === "INSPECTED") {
        await prisma.housekeepingTask.updateMany({
          where: { roomId, taskType: { not: "SPECIAL_REQUEST" }, status: { not: "COMPLETED" } },
          data: { status: "COMPLETED", completedAt: new Date() },
        })
      }
      await logActivity({
        ctx,
        module: "HOUSEKEEPING",
        action: "UPDATE",
        entityType: "Room",
        entityId: roomId,
        description: `Room ${existing.roomNumber}: ${changeDesc}`,
      })
      return NextResponse.json(updatedRoom)
    }
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
