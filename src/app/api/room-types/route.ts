import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'
import { assertRoomTypeCapacity } from '@/lib/license'
import { logActivity } from '@/lib/activity-log'
import { assertRoomTypeCodeFree, inventoryErrorResponse } from '@/lib/inventory-guards'

const featureSchema = z.object({
  category: z.enum(["BED_TYPE", "ROOM_VIEW", "ROOM_AMENITY"]),
  code: z.string().min(1),
})

const createSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().trim().min(2),
  code: z.string().trim().min(2),
  maxOccupancy: z.number().int().positive(),
  baseOccupancy: z.number().int().positive().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  isPseudo: z.boolean().optional(),
  housekeepingEnabled: z.boolean().optional(),
  features: z.array(featureSchema).optional(),
}).refine((d) => d.baseOccupancy === undefined || d.baseOccupancy <= d.maxOccupancy, {
  message: 'Base occupancy cannot be more than max occupancy',
  path: ['baseOccupancy'],
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
    await assertRoomTypeCodeFree(data.propertyId, data.code)

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
    const { status, body } = inventoryErrorResponse(error, toErrorResponse, 'That room type code is already used in this property.')
    return NextResponse.json(body, { status })
  }
}
