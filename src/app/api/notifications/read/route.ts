import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSession, toErrorResponse } from "@/lib/scope"
import { markRead, unreadCount } from "@/lib/notifications/inbox"

const body = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })])

// Mark the caller's OWN notifications read — some by id, or all. Ids that are not the
// caller's simply match nothing.
export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    const parsed = body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Send { all: true } or { ids: [...] }" }, { status: 400 })
    const changed = await markRead(ctx, parsed.data)
    return NextResponse.json({ changed, unreadCount: await unreadCount(ctx) })
  } catch (e) {
    const { status, body: b } = toErrorResponse(e)
    return NextResponse.json(b, { status })
  }
}
