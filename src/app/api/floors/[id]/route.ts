import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'
import { logActivity } from '@/lib/activity-log'
import {
  describeHistory,
  findInventoryHistory,
  hasHistory,
  inventoryErrorResponse,
  InventoryConflictError,
  roomList,
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
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    if (!name || !body.buildingId) {
      return NextResponse.json({ error: "Floor name and building are required" }, { status: 400 })
    }

    const existing = await prisma.floor.findUnique({ where: { id }, include: { building: true } })
    if (!existing) {
      return NextResponse.json({ error: "Floor not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.building.propertyId)

    const targetBuilding = await prisma.building.findUnique({ where: { id: body.buildingId } })
    if (!targetBuilding) {
      return NextResponse.json({ error: "Building not found" }, { status: 404 })
    }
    if (targetBuilding.propertyId !== existing.building.propertyId) {
      return NextResponse.json({ error: "Cannot move a floor to a building in a different property" }, { status: 400 })
    }

    const floor = await prisma.floor.update({
      where: { id: id },
      data: {
        name,
        buildingId: body.buildingId,
      },
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'UPDATE',
      entityType: 'Floor',
      entityId: floor.id,
      description: `Updated floor "${floor.name}" in building "${targetBuilding.name}"`,
    })

    return NextResponse.json(floor)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
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
    const existing = await prisma.floor.findUnique({ where: { id }, include: { building: true } })
    if (!existing) {
      return NextResponse.json({ error: "Floor not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.building.propertyId)

    // Deleting a floor deletes the rooms on it — so it is refused when any of them carries
    // booking/ticket history (src/lib/inventory-guards.ts). Check and delete in one
    // transaction.
    const deletedRooms = await prisma.$transaction(async (tx) => {
      const rooms = await tx.room.findMany({ where: { floorId: id }, select: { id: true } })
      const history = await findInventoryHistory(tx, { roomIds: rooms.map((r) => r.id) })
      if (hasHistory(history)) {
        throw new InventoryConflictError(
          `Floor "${existing.name}" has rooms with ${describeHistory(history)} (${roomList(history.roomNumbers)}) — move those rooms to another floor first.`
        )
      }
      const { count } = await tx.room.deleteMany({ where: { floorId: id } })
      await tx.floor.delete({ where: { id } })
      return count
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'DELETE',
      entityType: 'Floor',
      entityId: id,
      description: `Deleted floor "${existing.name}" from building "${existing.building.name}" and its ${deletedRooms} room(s)`,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = inventoryErrorResponse(error, toErrorResponse)
    return NextResponse.json(body, { status })
  }
}
