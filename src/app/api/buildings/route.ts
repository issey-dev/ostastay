import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const createSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(2),
})

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 })
    }

    const buildings = await prisma.building.findMany({
      where: { propertyId },
      include: { floors: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(buildings)
  } catch (error) {
    console.error('Failed to fetch buildings:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const json = await request.json()
    const data = createSchema.parse(json)

    const building = await prisma.building.create({
      data,
      include: { floors: true },
    })

    return NextResponse.json(building, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    console.error('Failed to create building:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
