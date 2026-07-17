import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'update')

    const { id } = await params;
    const body = await request.json()

    if (!body.roomNumber || !body.roomTypeId || !body.floorId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const existing = await prisma.room.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    const [roomType, floor] = await Promise.all([
      prisma.roomType.findUnique({ where: { id: body.roomTypeId } }),
      prisma.floor.findUnique({ where: { id: body.floorId }, include: { building: true } }),
    ])
    if (!roomType || roomType.propertyId !== existing.propertyId) {
      return NextResponse.json({ error: "Room type does not belong to this property" }, { status: 400 })
    }
    if (!floor || floor.building.propertyId !== existing.propertyId) {
      return NextResponse.json({ error: "Floor does not belong to this property" }, { status: 400 })
    }

    const room = await prisma.room.update({
      where: { id: id },
      data: {
        roomNumber: body.roomNumber,
        roomTypeId: body.roomTypeId,
        floorId: body.floorId,
      },
      include: {
        roomType: true,
        floor: true,
      }
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

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
