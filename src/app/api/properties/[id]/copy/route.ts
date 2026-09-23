import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireSession, requirePropertySetup, assertPropertyAccess, toErrorResponse } from "@/lib/scope"
import { logActivity } from "@/lib/activity-log"
import { COPY_SECTIONS, isCopySection, previewCopy, runCopy } from "@/lib/property-copy"

// "Copy from another property" into this one — src/lib/property-copy.ts has the rules
// (matched by code or name; what already exists here is warned about and skipped, never
// overwritten). The target needs Property Setup; the source must be a property the caller
// may open — so a single-property admin, who sees no other property, has nothing to copy.

const SECTION_LABEL: Record<(typeof COPY_SECTIONS)[number], string> = {
  lists: "dropdown lists",
  "tax-profiles": "tax profiles",
  "charge-codes": "charge codes",
  "payment-methods": "payment methods",
  stationery: "stationery wording",
  "meal-plans": "meal plans",
  "room-types": "room types",
  outlets: "outlets",
}

/**
 * GET ?section=&from=  — what the source has in that section, each item marked `exists`
 *                        when this property already has it (it would be skipped).
 * GET (no section)     — the properties this one can copy from.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    await requirePropertySetup(ctx, id, "CONTROLS", "view")
    const url = new URL(request.url)
    const section = url.searchParams.get("section")
    const from = url.searchParams.get("from")

    if (!section) {
      const sources =
        ctx.scope === "PROPERTY"
          ? []
          : await prisma.property.findMany({
              where: { enterpriseId: ctx.enterpriseId, id: { not: id }, status: "ACTIVE" },
              select: { id: true, name: true, code: true },
              orderBy: { name: "asc" },
            })
      return NextResponse.json({ sources })
    }
    if (!isCopySection(section)) return NextResponse.json({ error: "Unknown section" }, { status: 400 })
    if (!from) return NextResponse.json({ error: "from is required" }, { status: 400 })
    await assertPropertyAccess(ctx, from)
    return NextResponse.json({ items: await previewCopy(section, from, id) })
  } catch (error) {
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}

const copySchema = z.object({
  section: z.enum(COPY_SECTIONS),
  from: z.string().min(1),
  keys: z.array(z.string().min(1)).min(1, "Choose at least one item to copy").max(1000),
})

/** POST { section, from, keys } — copy the chosen items; returns what was copied, skipped and pulled along. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await requireSession()
    await requirePropertySetup(ctx, id, "CONTROLS", "create")
    const body = copySchema.parse(await request.json())
    await assertPropertyAccess(ctx, body.from)

    const report = await runCopy(body.section, body.from, id, body.keys)

    const [source, target] = await Promise.all([
      prisma.property.findUnique({ where: { id: body.from }, select: { name: true } }),
      prisma.property.findUnique({ where: { id }, select: { name: true } }),
    ])
    await logActivity({
      ctx,
      module: "CONTROLS",
      action: "CREATE",
      description:
        `Copied ${report.copied.length} ${SECTION_LABEL[body.section]} from ${source?.name ?? "another property"} to ${target?.name ?? "this property"}` +
        (report.pulled.length ? ` (+${report.pulled.length} pulled along)` : "") +
        (report.skipped.length ? `; skipped ${report.skipped.length} already there` : ""),
      entityType: "Property",
      entityId: id,
    })
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    const { status, body } = toErrorResponse(error)
    return NextResponse.json(body, { status })
  }
}
