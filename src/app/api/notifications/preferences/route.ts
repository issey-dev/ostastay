import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSession, toErrorResponse } from "@/lib/scope"
import { listPreferences, setPreference } from "@/lib/notifications/preferences"

// The signed-in user's own notification choices. No module permission: it is the caller's
// own data, keyed on the session's user.
export async function GET() {
  try {
    const ctx = await requireSession()
    return NextResponse.json({ preferences: await listPreferences(ctx.userId) })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}

const change = z
  .object({ type: z.string().min(1).max(60), inApp: z.boolean().optional(), push: z.boolean().optional() })
  .refine((v) => v.inApp !== undefined || v.push !== undefined, "Nothing to change")

export async function PUT(request: Request) {
  try {
    const ctx = await requireSession()
    const parsed = change.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Send { type, inApp?, push? }" }, { status: 400 })
    const { type, ...rest } = parsed.data
    if (!(await setPreference(ctx.userId, type, rest))) return NextResponse.json({ error: "Unknown kind of notification" }, { status: 400 })
    return NextResponse.json({ preferences: await listPreferences(ctx.userId) })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}
