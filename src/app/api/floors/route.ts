import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from '@/lib/scope'
import { logActivity } from '@/lib/activity-log'

const createSchema = z.object({
  buildingId: z.string().uuid(),
  name: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'create')

    const json = await request.json()
    const data = createSchema.parse(json)

    const building = await prisma.building.findUnique({ where: { id: data.buildingId } })
    if (!building) {
      return NextResponse.json({ error: "Building not found" }, { status: 404 })
    }
    await assertPropertyAccess(ctx, building.propertyId)

    const floor = await prisma.floor.create({
      data,
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'CREATE',
      entityType: 'Floor',
      entityId: floor.id,
      description: `Created floor "${floor.name}" in building "${building.name}"`,
    })

    return NextResponse.json(floor, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
