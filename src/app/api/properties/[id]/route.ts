import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, requirePropertyScope, toErrorResponse, ForbiddenError, type AuthContext } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"
import { isValidCurrency, isValidTimeZone, normalizeCurrency } from "@/lib/properties/property-input"
import { propertyProfilePatchSchema, profileFieldErrors } from "@/lib/properties/profile-schema"

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

function codeInUse(code?: string) {
  const message = code
    ? `Short code "${code}" is already in use by another property. Choose a different code.`
    : "That short code is already in use by another property. Choose a different code."
  return NextResponse.json({ error: message, fieldErrors: { code: message } }, { status: 409 })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    requirePermission(ctx, "CONTROLS", "update")
    const existing = await assertPropertyInEnterprise(ctx, id)

    const body = await request.json()

    // Profile fields (name, code, times, contact…) — validated with the same Zod rules the
    // Property Information form uses. Absent keys stay absent, so the one-field PUTs from
    // the other settings panels are unaffected.
    const parsed = propertyProfilePatchSchema.safeParse(body ?? {})
    if (!parsed.success) {
      const fieldErrors = profileFieldErrors(parsed.error)
      return NextResponse.json(
        { error: Object.values(fieldErrors)[0] ?? "Invalid property details", fieldErrors },
        { status: 400 },
      )
    }
    const profile = parsed.data

    // Short codes are unique across every property (Property.code @unique). Check first so
    // the user gets a readable message rather than a raw constraint error; the P2002 catch
    // below covers the race.
    if (profile.code !== undefined) {
      const clash = await prisma.property.findFirst({ where: { code: profile.code, NOT: { id } }, select: { id: true } })
      if (clash) return codeInUse(profile.code)
    }

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

    // Currency and time zone: validated here (src/lib/properties/property-input.ts, the
    // same rules as the create route), and editable only while the property has not gone
    // live (PENDING / REJECTED). Once ACTIVE every posted amount is in its currency and
    // every business date in its zone — changing either would re-denominate or shift
    // history, so the form shows them read-only and the API refuses a change. Re-sending
    // the SAME value is fine (the edit form sends both).
    const defaultCurrency = body.defaultCurrency === undefined ? undefined : normalizeCurrency(body.defaultCurrency)
    const timeZone = body.timeZone === undefined ? undefined : typeof body.timeZone === "string" ? body.timeZone.trim() : ""
    if (defaultCurrency !== undefined && !isValidCurrency(defaultCurrency)) {
      const message = "Currency must be a 3-letter code (e.g. USD, MVR)."
      return NextResponse.json({ error: message, fieldErrors: { defaultCurrency: message } }, { status: 400 })
    }
    if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
      const message = "Pick a valid time zone (e.g. Indian/Maldives)."
      return NextResponse.json({ error: message, fieldErrors: { timeZone: message } }, { status: 400 })
    }
    if (
      existing.status === "ACTIVE" &&
      ((defaultCurrency !== undefined && defaultCurrency !== existing.defaultCurrency) ||
        (timeZone !== undefined && timeZone !== existing.timeZone))
    ) {
      return NextResponse.json(
        { error: "Currency and time zone can't be changed once the property is active." },
        { status: 400 }
      )
    }

    // enterpriseId is deliberately never accepted here — a property can never be
    // reassigned to a different enterprise via this route.
    const property = await prisma.property.update({
      where: { id },
      data: {
        name: profile.name,
        code: profile.code,
        legalName: profile.legalName,
        defaultCurrency,
        timeZone,
        checkInTime: profile.checkInTime,
        checkOutTime: profile.checkOutTime,
        // logoUrl is set only by uploading (POST /api/properties/[id]/logo).
        taxId: profile.taxId,
        contactPhone: profile.contactPhone,
        contactEmail: profile.contactEmail,
        address: profile.address,
        // Only written when the caller actually sent the key. It previously fell through
        // to `null` whenever `starRating` was absent, so EVERY partial PUT silently wiped
        // the property's star rating — the banner-colour, stationery-font and
        // allocation-mode panels all send one-field bodies. Sending null or "" still clears
        // it deliberately (the schema maps "" to null and rejects anything outside 0–5).
        starRating: profile.starRating,
        bannerColor: body.bannerColor,
        // Stationery typeface (Controls > General > Appearance). undefined leaves it
        // unchanged so the banner-colour PUT and the font PUT don't clobber each other.
        stationeryFont: body.stationeryFont !== undefined ? body.stationeryFont : undefined,
        pricesIncludeTaxes: body.pricesIncludeTaxes !== undefined ? !!body.pricesIncludeTaxes : undefined,
        requireInspectionOnCheckIn: body.requireInspectionOnCheckIn !== undefined ? !!body.requireInspectionOnCheckIn : undefined,
        allocationCalculationMode: body.allocationCalculationMode,
        eodHousekeepingMode: body.eodHousekeepingMode,
        // Idle timeout for this property's sessions. 0 disables it. The floor is 5
        // minutes: lastSeenAt is stamped at most once a minute (TOUCH_INTERVAL_MS), so
        // anything tighter would sign people out unpredictably rather than promptly.
        sessionIdleMinutes:
          body.sessionIdleMinutes !== undefined
            ? Math.max(0, Number(body.sessionIdleMinutes) === 0 ? 0 : Math.max(5, Math.floor(Number(body.sessionIdleMinutes) || 0)))
            : undefined,
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
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return codeInUse()
    }
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
