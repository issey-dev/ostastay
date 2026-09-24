import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requireSession, requirePropertySetup, requirePermission, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"
import { assessBusinessDateChange, changeBusinessDate, parseBusinessDate } from "@/lib/business-date-change"

// Moving a property's business date by hand — the rules are in src/lib/business-date-change.ts.
// Property Setup (CONTROLS) for the property, plus NIGHT_AUDIT: moving the date stands in
// for running the audit.

/** GET ?date=YYYY-MM-DD — whether the date can move there, check by check. Changes nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    await requirePropertySetup(ctx, id, "CONTROLS", "view")
    const target = parseBusinessDate(new URL(request.url).searchParams.get("date"))
    return NextResponse.json(await assessBusinessDateChange(id, target))
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

/** POST { date: "YYYY-MM-DD" } — move the business date, when every check passes. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    await requirePropertySetup(ctx, id, "CONTROLS", "update")
    requirePermission(ctx, "NIGHT_AUDIT", "update")
    const body = await request.json().catch(() => null)
    const target = parseBusinessDate(body?.date)

    const result = await changeBusinessDate(id, target)
    const property = await prisma.property.findUnique({ where: { id }, select: { name: true } })
    await logActivity({
      ctx,
      module: "NIGHT_AUDIT",
      action: "UPDATE",
      description: `Changed the business date of ${property?.name ?? "a property"} from ${result.current} to ${result.target}${result.fresh ? " (new property, no activity yet)" : ""}`,
      entityType: "Property",
      entityId: id,
    })
    return NextResponse.json(result)
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
