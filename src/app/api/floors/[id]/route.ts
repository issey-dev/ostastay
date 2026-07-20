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

    if (!body.name || !body.buildingId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
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
        name: body.name,
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

    // Manually cascade delete rooms associated with this floor to avoid FK constraint errors
    await prisma.room.deleteMany({
      where: { floorId: id }
    })

    await prisma.floor.delete({
      where: { id: id },
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'DELETE',
      entityType: 'Floor',
      entityId: id,
      description: `Deleted floor "${existing.name}" from building "${existing.building.name}" and its rooms`,
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
