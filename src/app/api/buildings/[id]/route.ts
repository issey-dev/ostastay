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

    if (name.length < 2) {
      return NextResponse.json({ error: "Building name must be at least 2 characters" }, { status: 400 })
    }

    const existing = await prisma.building.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Building not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    const building = await prisma.building.update({
      where: { id: id },
      data: { name },
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'UPDATE',
      entityType: 'Building',
      entityId: building.id,
      description: `Renamed building "${existing.name}" to "${building.name}"`,
    })

    return NextResponse.json(building)
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
    const existing = await prisma.building.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Building not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    // A building takes its floors (DB cascade) and the rooms on them with it — refused when
    // any of those rooms carries booking/ticket history (src/lib/inventory-guards.ts).
    // Check and delete in one transaction, so it's all or nothing.
    const deletedRooms = await prisma.$transaction(async (tx) => {
      const rooms = await tx.room.findMany({ where: { floor: { buildingId: id } }, select: { id: true } })
      const history = await findInventoryHistory(tx, { roomIds: rooms.map((r) => r.id) })
      if (hasHistory(history)) {
        throw new InventoryConflictError(
          `Building "${existing.name}" has rooms with ${describeHistory(history)} (${roomList(history.roomNumbers)}) — move those rooms to another building first.`
        )
      }
      const { count } = await tx.room.deleteMany({ where: { id: { in: rooms.map((r) => r.id) } } })
      await tx.building.delete({ where: { id } })
      return count
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'DELETE',
      entityType: 'Building',
      entityId: id,
      description: `Deleted building "${existing.name}" with its floors and ${deletedRooms} room(s)`,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = inventoryErrorResponse(error, toErrorResponse)
    return NextResponse.json(body, { status })
  }
}
