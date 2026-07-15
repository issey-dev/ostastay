import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const createSchema = z.object({
  buildingId: z.string().uuid(),
  name: z.string().min(1),
})

export async function POST(request: Request) {
  try {
    const json = await request.json()
    const data = createSchema.parse(json)

    const floor = await prisma.floor.create({
      data,
    })

    return NextResponse.json(floor, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    console.error('Failed to create floor:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
