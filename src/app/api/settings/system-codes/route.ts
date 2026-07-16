import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const enterpriseId = searchParams.get('enterpriseId')
  const category = searchParams.get('category')

  if (!enterpriseId) {
    return NextResponse.json({ error: 'Enterprise ID is required' }, { status: 400 })
  }

  try {
    const codes = await prisma.systemCode.findMany({
      where: {
        enterpriseId,
        ...(category && { category }),
        isActive: true
      },
      orderBy: {
        sortOrder: 'asc'
      }
    })
    return NextResponse.json(codes)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch system codes' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { enterpriseId, category, code, value, sortOrder } = body

    if (!enterpriseId || !category || !code || !value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const newCode = await prisma.systemCode.create({
      data: {
        enterpriseId,
        category,
        code,
        value,
        sortOrder: sortOrder || 0
      }
    })

    return NextResponse.json(newCode)
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Code already exists for this category' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create system code' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    // Support bulk reordering or single update
    if (Array.isArray(body)) {
      // Bulk update (e.g., for reordering)
      const updates = body.map((item) =>
        prisma.systemCode.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder, isActive: item.isActive, value: item.value }
        })
      )
      await prisma.$transaction(updates)
      return NextResponse.json({ success: true })
    } else {
      // Single update
      const { id, value, sortOrder, isActive } = body
      if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })
      
      const updatedCode = await prisma.systemCode.update({
        where: { id },
        data: {
          value,
          sortOrder,
          isActive
        }
      })
      return NextResponse.json(updatedCode)
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update system code(s)' }, { status: 500 })
  }
}
