import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'

const createSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(2),
  code: z.string().min(2),
  maxOccupancy: z.number().int().positive(),
  basePrice: z.number().nonnegative(),
  description: z.string().optional(),
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

    const roomTypes = await prisma.roomType.findMany({
      where: { propertyId },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json(roomTypes)
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

    const roomType = await prisma.roomType.create({
      data,
    })

    return NextResponse.json(roomType, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
