import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from '@/lib/scope'

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')

    const codes = await prisma.systemCode.findMany({
      where: {
        enterpriseId: ctx.enterpriseId,
        ...(category && { category }),
        isActive: true
      },
      orderBy: {
        sortOrder: 'asc'
      }
    })
    return NextResponse.json(codes)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'create')

    const body = await request.json()
    const { category, code, value, sortOrder } = body

    if (!category || !code || !value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const newCode = await prisma.systemCode.create({
      data: {
        enterpriseId: ctx.enterpriseId,
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
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, 'CONTROLS', 'update')

    const body = await request.json()
    // Support bulk reordering or single update
    if (Array.isArray(body)) {
      // Bulk update (e.g., for reordering) — confirm every targeted row is this
      // enterprise's own before updating any of them.
      const existing = await prisma.systemCode.findMany({ where: { id: { in: body.map((item) => item.id) } } })
      if (existing.some((row) => row.enterpriseId !== ctx.enterpriseId)) {
        throw new ForbiddenError('System code not found')
      }

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

      const existing = await prisma.systemCode.findUnique({ where: { id } })
      if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: 'System code not found' }, { status: 404 })
      }

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
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
