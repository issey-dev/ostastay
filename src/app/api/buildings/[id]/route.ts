import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'
import { logActivity } from '@/lib/activity-log'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'update')

    const { id } = await params;
    const body = await request.json()

    if (!body.name) {
      return NextResponse.json({ error: "Missing building name" }, { status: 400 })
    }

    const existing = await prisma.building.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Building not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    const building = await prisma.building.update({
      where: { id: id },
      data: { name: body.name },
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

    // Find all floors for this building
    const floors = await prisma.floor.findMany({
      where: { buildingId: id }
    })

    // Delete all rooms on these floors to prevent FK constraint errors
    if (floors.length > 0) {
      await prisma.room.deleteMany({
        where: { floorId: { in: floors.map(f => f.id) } }
      })
    }

    await prisma.building.delete({
      where: { id: id },
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'DELETE',
      entityType: 'Building',
      entityId: id,
      description: `Deleted building "${existing.name}" and its floors/rooms`,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
