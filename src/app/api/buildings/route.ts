import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'

const createSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(2),
})

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'Property ID is required' }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    const buildings = await prisma.building.findMany({
      where: { propertyId },
      include: { floors: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(buildings)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'create')

    const json = await request.json()
    const data = createSchema.parse(json)
    await assertPropertyAccess(ctx, data.propertyId)

    const building = await prisma.building.create({
      data,
      include: { floors: true },
    })

    return NextResponse.json(building, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
