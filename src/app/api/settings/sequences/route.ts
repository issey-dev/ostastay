import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireSession, requirePermission, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"
import { assertSequenceChangeAllowed, greenTaxNumbersThisYear, highestIssuedNumber, SequenceGuardError } from "@/lib/sequence-guard"

// Just the plain integer counter itself — no prefix/format handling here (that's
// PropertySettings.resConfirmPrefix's job for confirmation numbers elsewhere). These
// six are sequential numbers only, never alphanumeric.
const SEQUENCE_TYPES = ["REGISTRATION_NO", "PROFORMA_FOLIO", "TAX_INVOICE", "RECEIPT_NO", "CHECK_NO", "GUEST_REG_NO"] as const

const putSchema = z.object({
  propertyId: z.string().uuid(),
  sequenceType: z.enum(SEQUENCE_TYPES),
  currentValue: z
    .number({ message: "Enter a number" })
    .int("Whole numbers only")
    .nonnegative("Can't be negative")
    .max(2_000_000_000, "That number is too large"),
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

    // What the UI needs to explain the guards before the user hits them: the highest
    // number already issued per document type (the counter's floor), and whether the
    // Green Tax register already holds numbers this year (the counter is then locked here).
    const greenTaxGiven = await greenTaxNumbersThisYear(propertyId)
    const sequences = await Promise.all(
      SEQUENCE_TYPES.map(async (sequenceType) => ({
        sequenceType,
        currentValue: byType.get(sequenceType)?.currentValue ?? 0,
        updatedAt: byType.get(sequenceType)?.updatedAt ?? null,
        highestIssued: sequenceType === "GUEST_REG_NO" ? null : await highestIssuedNumber(propertyId, sequenceType),
        locked: sequenceType === "GUEST_REG_NO" && greenTaxGiven > 0,
      }))
    )

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
    // Never let a counter go below a number already printed on a document, and leave
    // the Green Tax counter to the register's own corrections once numbers exist.
    await assertSequenceChangeAllowed(data.propertyId, data.sequenceType, data.currentValue)

    // The guest registration number is year-scoped (resets each 1 Jan). Stamp the
    // current year when it's set manually so the next EOD assignment respects the
    // value instead of treating a null year as "new year → reset to 0".
    const resetYear = data.sequenceType === "GUEST_REG_NO" ? new Date().getUTCFullYear() : undefined
    const updated = await prisma.propertySequence.upsert({
      where: { propertyId_sequenceType: { propertyId: data.propertyId, sequenceType: data.sequenceType } },
      update: { currentValue: data.currentValue, ...(resetYear !== undefined ? { resetYear } : {}) },
      create: { propertyId: data.propertyId, sequenceType: data.sequenceType, currentValue: data.currentValue, resetYear },
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
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid value", issues: error.issues }, { status: 400 })
    }
    if (error instanceof SequenceGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
