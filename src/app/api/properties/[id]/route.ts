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

    if (body.eodHousekeepingMode !== undefined && !["OFF", "STEP_DOWN", "SET_STATUS"].includes(body.eodHousekeepingMode)) {
      return NextResponse.json({ error: "eodHousekeepingMode must be OFF, STEP_DOWN or SET_STATUS" }, { status: 400 })
    }
    // SET_STATUS needs a valid sellable target; the shift never writes OOO/OOS.
    if (body.eodHousekeepingMode === "SET_STATUS" && !["CLEAN", "DIRTY", "INSPECTED"].includes(body.eodHousekeepingTargetStatus)) {
      return NextResponse.json({ error: "eodHousekeepingTargetStatus must be CLEAN, DIRTY or INSPECTED when mode is SET_STATUS" }, { status: 400 })
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
        address: body.address,
        starRating: body.starRating !== undefined && body.starRating !== null && body.starRating !== "" ? parseInt(body.starRating) : null,
        bannerColor: body.bannerColor,
        // Stationery typeface (Controls > General > Appearance). undefined leaves it
        // unchanged so the banner-colour PUT and the font PUT don't clobber each other.
        stationeryFont: body.stationeryFont !== undefined ? body.stationeryFont : undefined,
        pricesIncludeTaxes: body.pricesIncludeTaxes !== undefined ? !!body.pricesIncludeTaxes : undefined,
        requireInspectionOnCheckIn: body.requireInspectionOnCheckIn !== undefined ? !!body.requireInspectionOnCheckIn : undefined,
        allocationCalculationMode: body.allocationCalculationMode,
        eodHousekeepingMode: body.eodHousekeepingMode,
        // Clear the target unless we're in SET_STATUS mode, so a stale target can't
        // linger after switching to OFF/STEP_DOWN.
        eodHousekeepingTargetStatus:
          body.eodHousekeepingMode === undefined
            ? undefined
            : body.eodHousekeepingMode === "SET_STATUS"
              ? body.eodHousekeepingTargetStatus
              : null,
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
