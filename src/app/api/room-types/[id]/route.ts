import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'

const updateSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  maxOccupancy: z.number().int().positive(),
  basePrice: z.number().nonnegative(),
  description: z.string().optional(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'update')

    const { id } = await params;
    const json = await request.json()
    const data = updateSchema.parse(json)

    const existing = await prisma.roomType.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room type not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    const roomType = await prisma.roomType.update({
      where: { id },
      data,
    })

    return NextResponse.json(roomType)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
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
    const existing = await prisma.roomType.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: "Room type not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, existing.propertyId)

    // Manually cascade delete rooms of this type
    await prisma.room.deleteMany({
      where: { roomTypeId: id }
    })

    await prisma.roomType.delete({
      where: { id: id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
