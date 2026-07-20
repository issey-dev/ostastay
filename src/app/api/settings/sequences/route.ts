import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"

// Just the plain integer counter itself — no prefix/format handling here (that's
// EnterpriseSettings.resConfirmPrefix's job for confirmation numbers elsewhere). These
// four are sequential numbers only, never alphanumeric.
const SEQUENCE_TYPES = ["REGISTRATION_NO", "PROFORMA_FOLIO", "TAX_INVOICE", "RECEIPT_NO"] as const

const putSchema = z.object({
  propertyId: z.string().uuid(),
  sequenceType: z.enum(SEQUENCE_TYPES),
  currentValue: z.number().int().nonnegative(),
})

export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get("propertyId")

    if (!propertyId) {
      return NextResponse.json({ error: "Property ID is required" }, { status: 400 })
    }
    await assertPropertyAccess(ctx, propertyId)

    const rows = await prisma.propertySequence.findMany({ where: { propertyId } })
    const byType = new Map(rows.map((r) => [r.sequenceType, r]))

    const sequences = SEQUENCE_TYPES.map((sequenceType) => ({
      sequenceType,
      currentValue: byType.get(sequenceType)?.currentValue ?? 0,
      updatedAt: byType.get(sequenceType)?.updatedAt ?? null,
    }))

    return NextResponse.json(sequences)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession()
    requirePermission(ctx, "CONTROLS", "update")

    const json = await request.json()
    const data = putSchema.parse(json)
    await assertPropertyAccess(ctx, data.propertyId)

    const updated = await prisma.propertySequence.upsert({
      where: { propertyId_sequenceType: { propertyId: data.propertyId, sequenceType: data.sequenceType } },
      update: { currentValue: data.currentValue },
      create: { propertyId: data.propertyId, sequenceType: data.sequenceType, currentValue: data.currentValue },
    })

    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "UPDATE",
      entityType: "PropertySequence",
      entityId: updated.id,
      description: `Set sequence ${data.sequenceType} to ${data.currentValue}`,
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 })
    }
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
