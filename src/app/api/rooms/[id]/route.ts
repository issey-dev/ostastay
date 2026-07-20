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

    if (!body.roomNumber || !body.roomTypeId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const existing = await prisma.room.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    const roomType = await prisma.roomType.findUnique({ where: { id: body.roomTypeId } })
    if (!roomType || roomType.propertyId !== existing.propertyId) {
      return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 })
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
        roomNumber: body.roomNumber,
        roomTypeId: body.roomTypeId,
        floorId,
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
    const existing = await prisma.room.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    await prisma.room.delete({
      where: { id: id },
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
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
