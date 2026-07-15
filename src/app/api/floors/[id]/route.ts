import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json()

    if (!body.name || !body.buildingId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const floor = await prisma.floor.update({
      where: { id: id },
      data: {
        name: body.name,
        buildingId: body.buildingId,
      },
    })

    return NextResponse.json(floor)
  } catch (error) {
    console.error('Failed to update floor:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Manually cascade delete rooms associated with this floor to avoid FK constraint errors
    await prisma.room.deleteMany({
      where: { floorId: id }
    })

    await prisma.floor.delete({
      where: { id: id },
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to delete floor:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
