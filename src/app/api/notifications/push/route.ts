import { NextResponse } from "next/server"
import { z } from "zod"
import { requireSession, toErrorResponse } from "@/lib/scope"
import { prisma } from "@/lib/db"
import { pushConfig, removeSubscription, saveSubscription } from "@/lib/notifications/push"

// Phone/browser push registration for the signed-in user's CURRENT device.

/** Is push set up on the server, the public key to subscribe with, and how many devices the user has. */
export async function GET() {
  try {
    const ctx = await requireSession()
    const config = pushConfig()
    const devices = config ? await prisma.pushSubscription.count({ where: { userId: ctx.userId } }) : 0
    return NextResponse.json({ configured: !!config, publicKey: config?.publicKey ?? null, devices })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}

const subscription = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(10).max(100) }),
})

/** Register this device. Re-registering the same device just refreshes it. */
export async function POST(request: Request) {
  try {
    const ctx = await requireSession()
    if (!pushConfig()) return NextResponse.json({ error: "Phone notifications are not set up on this server yet." }, { status: 503 })
    const parsed = subscription.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "That is not a valid push subscription." }, { status: 400 })
    const { endpoint, keys } = parsed.data
    await saveSubscription({
      userId: ctx.userId,
      enterpriseId: ctx.enterpriseId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: request.headers.get("user-agent"),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}

/**
 * Forget a device by its endpoint. Deliberately works WITHOUT a session: it is called as the
 * person signs out (and when an idle session has already expired), and the endpoint is an
 * unguessable address only that device holds — knowing it is the authority to remove it.
 * The device also unsubscribes itself in the browser, which is what really stops delivery.
 */
export async function DELETE(request: Request) {
  try {
    const body = z.object({ endpoint: z.string().url().max(1000) }).safeParse(await request.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: "Send { endpoint }." }, { status: 400 })
    await removeSubscription(body.data.endpoint)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return NextResponse.json(body, { status })
  }
}
