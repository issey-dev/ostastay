import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, assertPropertyAccess, requirePropertySetup, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"
import { getPropertySettings, propertySettingsPatchSchema, updatePropertySettings } from "@/lib/property-settings"

// One property's document content + booking-number format (PropertySettings) — see
// .agents/docs/HUB_SETUP_PLAN.md, Phase 1.
//
// GET is readable by anyone who works at the property (front desk needs to know whether
// the registration card step is on, which folio layout to open on) — it holds no secrets.
// PATCH is Property Setup, through requirePropertySetup(): the property must be the
// caller's own (single-property users) and they must hold CONTROLS update.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    await assertPropertyAccess(ctx, id)
    return NextResponse.json(await getPropertySettings(id))
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    await requirePropertySetup(ctx, id, "CONTROLS", "update")

    const parsed = propertySettingsPatchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json(
        { error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid settings" },
        { status: 400 }
      )
    }

    const settings = await updatePropertySettings(id, parsed.data)
    const property = await prisma.property.findUnique({ where: { id }, select: { name: true, code: true } })
    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "PropertySettings",
      entityId: id,
      description: `Updated document & booking settings for "${property?.name ?? id}" (${Object.keys(parsed.data).join(", ")})`,
    })
    return NextResponse.json(settings)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
