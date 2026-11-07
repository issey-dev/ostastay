import { NextResponse } from "next/server"
import { requireSession, toErrorResponse } from "@/lib/scope"
import { hasReadInstallInvite } from "@/lib/notifications/install-offer"

// Has the signed-in person read the one-time "install the app" invitation? The Account dialog
// asks when it opens, and shows its Install option only if so. The caller's own data.
export async function GET() {
  try {
    const ctx = await requireSession()
    return NextResponse.json({ read: await hasReadInstallInvite(ctx.userId) })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}
