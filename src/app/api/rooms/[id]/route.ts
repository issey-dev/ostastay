import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json()

    if (!body.roomNumber || !body.roomTypeId || !body.floorId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
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
    console.error('Failed to update room:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.room.delete({
      where: { id: id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to delete room:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
