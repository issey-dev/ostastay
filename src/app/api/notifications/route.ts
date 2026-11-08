import { NextResponse } from "next/server"
import { requireSession, toErrorResponse } from "@/lib/scope"
import { listInbox, unreadCount } from "@/lib/notifications/inbox"

// The signed-in user's own notifications, newest first, plus their unread count.
// Every signed-in user has a bell, so there is no module permission here: the data is
// scoped to the caller by construction (see inbox.ts).
export async function GET(request: Request) {
  try {
    const ctx = await requireSession()
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get("limit") ?? 20)
    const [page, unread] = await Promise.all([
      listInbox(ctx, {
        limit: Number.isFinite(limit) ? limit : 20,
        before: url.searchParams.get("before"),
        unreadOnly: url.searchParams.get("unread") === "1",
      }),
      unreadCount(ctx),
    ])
    return NextResponse.json({ ...page, unreadCount: unread })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}
