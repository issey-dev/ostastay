import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, toErrorResponse, ForbiddenError } from "@/lib/scope"

async function assertPropertyInEnterprise(id: string, enterpriseId: string) {
  const property = await prisma.property.findUnique({ where: { id } })
  if (!property || property.enterpriseId !== enterpriseId) {
    throw new ForbiddenError("Property not found")
  }
  return property
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    requirePermission(ctx, "CONTROLS", "update")
    await assertPropertyInEnterprise(id, ctx.enterpriseId)

    const body = await request.json()

    const property = await prisma.property.update({
      where: { id },
      data: {
        name: body.name,
        code: body.code,
        legalName: body.legalName,
        defaultCurrency: body.defaultCurrency,
        timeZone: body.timeZone,
        checkInTime: body.checkInTime,
        checkOutTime: body.checkOutTime,
      },
    })

    return NextResponse.json(property)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    requirePermission(ctx, "CONTROLS", "delete")
    await assertPropertyInEnterprise(id, ctx.enterpriseId)

    await prisma.property.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
