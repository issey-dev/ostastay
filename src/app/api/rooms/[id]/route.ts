import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'
import { logActivity } from '@/lib/activity-log'
import { assertRoomCapacity } from '@/lib/license'
import {
  assertRoomNumberFree,
  describeHistory,
  findInventoryHistory,
  hasHistory,
  inventoryErrorResponse,
  InventoryConflictError,
} from '@/lib/inventory-guards'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'update')

    const { id } = await params;
    const body = await request.json()
    const roomNumber = body.roomNumber == null ? "" : String(body.roomNumber).trim()

    if (!roomNumber || !body.roomTypeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const existing = await prisma.room.findUnique({ where: { id }, include: { roomType: true } })
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    const roomType = await prisma.roomType.findUnique({ where: { id: body.roomTypeId } })
    if (!roomType || roomType.propertyId !== existing.propertyId) {
      return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 })
    }

    // Moving a room onto another room type follows the same rules as creating one there:
    // not onto an inactive type, and not past the licence's room cap. Keeping the room's
    // current type is always allowed (it may have been deactivated since — editing the
    // room number of such a room must still work).
    const typeChanging = roomType.id !== existing.roomTypeId
    if (typeChanging && !roomType.isActive) {
      return NextResponse.json({ error: "Cannot move a room to an inactive room type" }, { status: 400 })
    }
    // Rooms of a pseudo (PM) type are outside the cap, so only pseudo → real adds one.
    if (typeChanging && !roomType.isPseudo && existing.roomType.isPseudo) {
      await assertRoomCapacity(existing.propertyId)
    }

    if (roomNumber !== existing.roomNumber) {
      await assertRoomNumberFree(existing.propertyId, roomNumber, id)
    }

    // A Pseudo room type has no physical location — Building/Floor are skipped
    // entirely, never just left blank by mistake.
    let floorId: string | null = null
    if (!roomType.isPseudo) {
      if (!body.floorId) {
        return NextResponse.json({ error: "Floor is required for a physical room" }, { status: 400 })
      }
      const floor = await prisma.floor.findUnique({ where: { id: body.floorId }, include: { building: true } })
      if (!floor || floor.building.propertyId !== existing.propertyId) {
        return NextResponse.json({ error: "Floor does not belong to this property" }, { status: 400 })
      }
      floorId = body.floorId
    }

    const features = Array.isArray(body.features) ? body.features : undefined

    const room = await prisma.room.update({
      where: { id: id },
      data: {
        roomNumber,
        roomTypeId: body.roomTypeId,
        floorId,
        // A room that is out of service only because its OLD type was deactivated comes
        // back (to DIRTY, for inspection) when it is moved onto an active type — the same
        // rule as re-activating the type (src/app/api/room-types/[id]/route.ts).
        ...(typeChanging && existing.statusBeforeTypeDeactivation && {
          statusBeforeTypeDeactivation: null,
          ...(existing.status === "OUT_OF_SERVICE" && {
            status: existing.statusBeforeTypeDeactivation === "OUT_OF_ORDER" ? "OUT_OF_ORDER" : "DIRTY",
          }),
        }),
        ...(features !== undefined && {
          features: {
            deleteMany: {},
            create: roomType.isPseudo ? [] : features,
          },
        }),
      },
      include: {
        roomType: { include: { features: true } },
        floor: true,
        features: true,
      }
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'UPDATE',
      entityType: 'Room',
      entityId: room.id,
      description: `Updated room ${room.roomNumber}`,
    })

    return NextResponse.json(room)
  } catch (error) {
    const { status, body } = inventoryErrorResponse(error, toErrorResponse, "That room number already exists in this property.")
    return NextResponse.json(body, { status })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'delete')

    const { id } = await params;
    const existing = await prisma.room.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    // Room.RoomAssignment is ON DELETE SET NULL, so deleting a booked room used to succeed
    // and silently un-assign every reservation that had it. Refuse instead (see
    // src/lib/inventory-guards.ts); rooms have no "inactive" flag, so out of service is the
    // way to retire one with history.
    await prisma.$transaction(async (tx) => {
      const history = await findInventoryHistory(tx, { roomIds: [id] })
      if (hasHistory(history)) {
        throw new InventoryConflictError(
          `Room ${existing.roomNumber} has ${describeHistory(history)} — set it Out of Service instead.`
        )
      }
      await tx.room.delete({ where: { id } })
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'DELETE',
      entityType: 'Room',
      entityId: id,
      description: `Deleted room ${existing.roomNumber}`,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = inventoryErrorResponse(error, toErrorResponse)
    return NextResponse.json(body, { status })
  }
}
