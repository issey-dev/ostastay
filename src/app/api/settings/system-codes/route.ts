import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  requireSession,
  requirePermission,
  requireEnterpriseHub,
  requirePropertySetup,
  assertPropertyAccess,
  toErrorResponse,
  ForbiddenError,
  type AuthContext,
} from '@/lib/scope'
import { logActivity } from '@/lib/activity-log'
import { isPropertyListCategory } from '@/lib/system-code-scope'

// Dropdown list options. A category is either a PROPERTY list (each property its own —
// needs ?propertyId= / body propertyId, and is Property Setup for that property) or an
// ENTERPRISE list (guest-profile lists, Job Functions — the Hub's enterprise area only).
// Which is which: src/lib/system-code-scope.ts.

// May this caller change a list at this level? Property lists are that property's
// Property Setup; enterprise lists need the enterprise area, which a single-property user
// never has.
async function authorizeWrite(ctx: AuthContext, propertyId: string | null, action: 'create' | 'update') {
  if (propertyId) {
    await requirePropertySetup(ctx, propertyId, 'CONTROLS', action)
  } else {
    requireEnterpriseHub(ctx)
    requirePermission(ctx, 'CONTROLS', action)
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')
    const propertyId = searchParams.get('propertyId')

    if (propertyId) await assertPropertyAccess(ctx, propertyId)

    let where
    if (category && isPropertyListCategory(category)) {
      // One property's own list — never another property's.
      if (!propertyId) {
        return NextResponse.json({ error: `propertyId is required for ${category}` }, { status: 400 })
      }
      where = { propertyId, category }
    } else if (category) {
      where = { enterpriseId: ctx.enterpriseId, propertyId: null, category }
    } else {
      // Every list the caller can see here: the enterprise's, plus the given property's.
      where = {
        enterpriseId: ctx.enterpriseId,
        OR: [{ propertyId: null }, ...(propertyId ? [{ propertyId }] : [])],
      }
    }

    const codes = await prisma.systemCode.findMany({
      where: { ...where, isActive: true },
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

    const body = await request.json()
    const { category, code, value, sortOrder } = body

    if (!category || !code || !value) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // A property list is always one property's; an enterprise list never is.
    const propertyId: string | null = isPropertyListCategory(category) ? body.propertyId ?? null : null
    if (isPropertyListCategory(category) && !propertyId) {
      return NextResponse.json({ error: `propertyId is required for ${category}` }, { status: 400 })
    }
    await authorizeWrite(ctx, propertyId, 'create')

    const newCode = await prisma.systemCode.create({
      data: {
        enterpriseId: ctx.enterpriseId,
        propertyId,
        category,
        code,
        value,
        sortOrder: sortOrder || 0
      }
    })

    await logActivity({
      ctx,
      module: 'CONTROLS',
      action: 'CREATE',
      entityType: 'SystemCode',
      entityId: newCode.id,
      description: `Created system code ${newCode.code} ("${newCode.value}") in ${newCode.category}`,
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

    const body = await request.json()
    // Support bulk reordering or single update
    if (Array.isArray(body)) {
      // Bulk update (e.g., for reordering) — confirm every targeted row is this
      // enterprise's own, and that the caller may change each list it touches, before
      // updating any of them.
      const existing = await prisma.systemCode.findMany({ where: { id: { in: body.map((item) => item.id) } } })
      if (existing.length !== body.length || existing.some((row) => row.enterpriseId !== ctx.enterpriseId)) {
        throw new ForbiddenError('System code not found')
      }
      for (const level of new Set(existing.map((row) => row.propertyId))) {
        await authorizeWrite(ctx, level, 'update')
      }

      const updates = body.map((item) =>
        prisma.systemCode.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder, isActive: item.isActive, value: item.value }
        })
      )
      await prisma.$transaction(updates)

      await logActivity({
        ctx,
        module: 'CONTROLS',
        action: 'UPDATE',
        entityType: 'SystemCode',
        description: `Updated ${body.length} system code(s) (bulk reorder/edit)`,
      })

      return NextResponse.json({ success: true })
    } else {
      // Single update
      const { id, value, sortOrder, isActive } = body
      if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

      const existing = await prisma.systemCode.findUnique({ where: { id } })
      if (!existing || existing.enterpriseId !== ctx.enterpriseId) {
        return NextResponse.json({ error: 'System code not found' }, { status: 404 })
      }
      await authorizeWrite(ctx, existing.propertyId, 'update')

      const updatedCode = await prisma.systemCode.update({
        where: { id },
        data: {
          value,
          sortOrder,
          isActive
        }
      })
      await logActivity({
        ctx,
        module: 'CONTROLS',
        action: 'UPDATE',
        entityType: 'SystemCode',
        entityId: updatedCode.id,
        description: `Updated system code ${updatedCode.code} ("${updatedCode.value}") in ${updatedCode.category}`,
      })

      return NextResponse.json(updatedCode)
    }
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
