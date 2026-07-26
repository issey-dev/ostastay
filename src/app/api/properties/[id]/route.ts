import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, requirePropertyScope, toErrorResponse, ForbiddenError, type AuthContext } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"

// Confirms the property is in the caller's enterprise AND — for a PROPERTY-scoped user —
// is their own work location (requirePropertyScope). Without the scope check, a
// property-scoped user with CONTROLS write could edit/delete a SIBLING property in the
// same enterprise. Deliberately does NOT gate on ACTIVE status (unlike assertPropertyAccess)
// so a PENDING property can still be edited here.
async function assertPropertyInEnterprise(ctx: AuthContext, id: string) {
  const property = await prisma.property.findUnique({ where: { id } })
  if (!property || property.enterpriseId !== ctx.enterpriseId) {
    throw new ForbiddenError("Property not found")
  }
  requirePropertyScope(ctx, id)
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
    await assertPropertyInEnterprise(ctx, id)

    const body = await request.json()

    if (body.allocationCalculationMode !== undefined && !["RATE_PLAN", "MEAL_PLAN"].includes(body.allocationCalculationMode)) {
      return NextResponse.json({ error: "allocationCalculationMode must be RATE_PLAN or MEAL_PLAN" }, { status: 400 })
    }

    // enterpriseId is deliberately never accepted here — a property can never be
    // reassigned to a different enterprise via this route.
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
        logoUrl: body.logoUrl,
        taxId: body.taxId,
        contactPhone: body.contactPhone,
        contactEmail: body.contactEmail,
        starRating: body.starRating !== undefined && body.starRating !== null && body.starRating !== "" ? parseInt(body.starRating) : null,
        bannerColor: body.bannerColor,
        pricesIncludeTaxes: body.pricesIncludeTaxes !== undefined ? !!body.pricesIncludeTaxes : undefined,
        requireInspectionOnCheckIn: body.requireInspectionOnCheckIn !== undefined ? !!body.requireInspectionOnCheckIn : undefined,
        allocationCalculationMode: body.allocationCalculationMode,
      },
    })

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "Property",
      entityId: property.id,
      description: `Updated property "${property.name}" (${property.code})`,
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
    const property = await assertPropertyInEnterprise(ctx, id)

    await prisma.property.delete({
      where: { id },
    })

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "DELETE",
      entityType: "Property",
      entityId: id,
      description: `Deleted property "${property.name}" (${property.code})`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
