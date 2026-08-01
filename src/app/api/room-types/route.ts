import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'
import { assertRoomTypeCapacity } from '@/lib/license'
import { logActivity } from '@/lib/activity-log'

const featureSchema = z.object({
  category: z.enum(["BED_TYPE", "ROOM_VIEW", "ROOM_AMENITY"]),
  code: z.string().min(1),
})

const createSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(2),
  code: z.string().min(2),
  maxOccupancy: z.number().int().positive(),
  baseOccupancy: z.number().int().positive().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  isPseudo: z.boolean().optional(),
  housekeepingEnabled: z.boolean().optional(),
  features: z.array(featureSchema).optional(),
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
      include: { features: true },
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
    const { features, ...data } = createSchema.parse(json)
    await assertPropertyAccess(ctx, data.propertyId)

    // License cap — pseudo (PM) room types are outside the licensed count by rule,
    // so only a real room type consumes an allowance slot.
    if (!data.isPseudo) {
      await assertRoomTypeCapacity(data.propertyId)
    }

    const roomType = await prisma.roomType.create({
      data: {
        ...data,
        features: features && features.length > 0 ? { create: features } : undefined,
      },
      include: { features: true },
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'CREATE',
      entityType: 'RoomType',
      entityId: roomType.id,
      description: `Created room type "${roomType.name}" (${roomType.code})`,
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
