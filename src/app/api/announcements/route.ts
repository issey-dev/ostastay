import { NextResponse } from "next/server"
import { requireSession, requireEnterpriseHub, requirePermission, toErrorResponse } from "@/lib/scope"
import { announcementSchema, listAnnouncements, sendAnnouncement } from "@/lib/notifications/announcements"
import { logActivity } from "@/lib/activity-log"

// Announcements from the Hub (enterprise area): who sent what, and send a new one.
// Viewing needs CONTROLS view, sending needs CONTROLS update, like the rest of the
// enterprise setup pages.
export async function GET() {
  try {
    const ctx = await requireSession()
    requireEnterpriseHub(ctx)
    requirePermission(ctx, "CONTROLS", "view")
    return NextResponse.json({ announcements: await listAnnouncements(ctx.enterpriseId) })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    requireEnterpriseHub(ctx)
    requirePermission(ctx, "CONTROLS", "update")
    const parsed = announcementSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the announcement and try again" }, { status: 400 })
    const result = await sendAnnouncement(ctx, parsed.data)
    if (result.id) {
      await logActivity({
        ctx,
        module: "CONTROLS",
        action: "CREATE",
        entityType: "Notification",
        entityId: result.id,
        description: `Sent an announcement "${parsed.data.title}" to ${result.recipients} ${result.recipients === 1 ? "person" : "people"}`,
      })
    }
    return NextResponse.json(result, { status: result.id ? 201 : 200 })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}
