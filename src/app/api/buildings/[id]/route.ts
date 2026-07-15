import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json()

    if (!body.name) {
      return NextResponse.json({ error: "Missing building name" }, { status: 400 })
    }

    const building = await prisma.building.update({
      where: { id: id },
      data: { name: body.name },
    })

    return NextResponse.json(building)
  } catch (error) {
    console.error('Failed to update building:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('Failed to delete building:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
