import { sendNotification } from "web-push"
import { prisma } from "@/lib/db"
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto"

// Phone / browser push (Web Push, VAPID) — NOTIFICATIONS_PLAN.md section 6.
//
// Best-effort by design (principle 3): the bell is the source of truth, push only tells a
// person sooner. So sending never throws, never blocks the action that raised the
// notification, and a dead device is simply forgotten.
//
// Off unless the three VAPID_* variables are set (the app works fine without them; the
// bell's phone toggle says it is not set up). Generate a pair once per environment with
//   npx web-push generate-vapid-keys

/** A device that fails this many sends in a row is dropped. */
export const MAX_FAILURES = 5

export type PushConfig = { publicKey: string; privateKey: string; subject: string }

export function pushConfig(env: Record<string, string | undefined> = process.env): PushConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  const subject = env.VAPID_SUBJECT?.trim()
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null
}

export type PushPayload = {
  title: string
  body?: string | null
  /** Same-origin path opened when the notification is tapped. */
  url?: string | null
  /** Collapses a re-sent notification into one on the device. */
  tag: string
  urgent?: boolean
}

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  body: string,
  opts: { TTL: number; urgency: "high" | "normal"; timeout: number; vapidDetails: { subject: string; publicKey: string; privateKey: string } },
) => Promise<unknown>

const defaultSender: PushSender = (sub, body, opts) => sendNotification(sub, body, opts)

/** Pure: should this response drop the device for good? 404/410 = the push service says it is gone. */
export function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410
}

/** Save (or replace) this device for the user. The auth secret is stored encrypted. */
export async function saveSubscription(a: {
  userId: string
  enterpriseId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}) {
  const authEncrypted = encryptSecret(a.auth) ?? a.auth
  const data = { userId: a.userId, enterpriseId: a.enterpriseId, p256dh: a.p256dh, authEncrypted, userAgent: a.userAgent?.slice(0, 300) ?? null, failureCount: 0 }
  await prisma.pushSubscription.upsert({ where: { endpoint: a.endpoint }, create: { endpoint: a.endpoint, ...data }, update: data })
}

/** Forget a device by its endpoint (sign-out, turned off, or gone). Unknown endpoint = nothing to do. */
export async function removeSubscription(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } })
}

/** Send a push to every device these users have registered. Never throws. */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  deps: { send?: PushSender; config?: PushConfig | null } = {},
): Promise<{ sent: number; dropped: number; failed: number }> {
  const result = { sent: 0, dropped: 0, failed: 0 }
  try {
    const config = deps.config === undefined ? pushConfig() : deps.config
    if (!config || userIds.length === 0) return result
    const send = deps.send ?? defaultSender

    const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } })
    const body = JSON.stringify({ title: payload.title, body: payload.body ?? "", url: payload.url ?? "/dashboard", tag: payload.tag })

    await Promise.all(
      subs.map(async (s) => {
        try {
          const auth = decryptSecret(s.authEncrypted)
          if (!auth) throw new Error("no auth secret")
          await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth } }, body, {
            TTL: 3600,
            urgency: payload.urgent ? "high" : "normal",
            timeout: 10_000,
            vapidDetails: config,
          })
          result.sent += 1
          await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: new Date(), failureCount: 0 } })
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          if (isGone(status) || s.failureCount + 1 >= MAX_FAILURES) {
            result.dropped += 1
            await prisma.pushSubscription.deleteMany({ where: { id: s.id } })
          } else {
            result.failed += 1
            await prisma.pushSubscription.updateMany({ where: { id: s.id }, data: { failureCount: { increment: 1 } } })
          }
        }
      }),
    )
  } catch (e) {
    console.error("[push] send failed", e)
  }
  return result
}
