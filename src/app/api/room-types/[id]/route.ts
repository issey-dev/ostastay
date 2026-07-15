import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'

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
    const { id } = await params;
    const json = await request.json()
    const data = updateSchema.parse(json)

    const roomType = await prisma.roomType.update({
      where: { id },
      data,
    })

    return NextResponse.json(roomType)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    console.error('Failed to update room type:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Manually cascade delete rooms of this type
    await prisma.room.deleteMany({
      where: { roomTypeId: id }
    })

    await prisma.roomType.delete({
      where: { id: id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to delete room type:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
