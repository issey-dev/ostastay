import { describe, it, expect, beforeAll } from "vitest"
import type { PushSender } from "@/lib/notifications/push"

// Phone push (NOTIFICATIONS_PLAN.md section 6): who is sent to, what is sent, and how a dead
// device is forgotten. The network sender is injected, so nothing leaves the machine.

const { prisma } = await import("@/lib/db")
const push = await import("@/lib/notifications/push")

const config = { publicKey: "pub", privateKey: "priv", subject: "mailto:test@example.test" }

describe("push notifications", () => {
  const tag = `push-${Date.now()}`
  let enterpriseId: string, userA: string, userB: string

  beforeAll(async () => {
    enterpriseId = (await prisma.enterprise.create({ data: { name: tag, slug: tag, type: "STANDARD" } })).id
    const mk = async (n: string) =>
      (await prisma.user.create({ data: { enterpriseId, email: `${tag}-${n}@example.test`, passwordHash: "x", firstName: n, lastName: "T", scope: "ENTERPRISE" } })).id
    userA = await mk("a")
    userB = await mk("b")
  })

  const sub = (userId: string, n: string) =>
    push.saveSubscription({ userId, enterpriseId, endpoint: `https://push.example.test/${tag}/${n}`, p256dh: "p".repeat(20), auth: "a".repeat(16), userAgent: "test" })
  const payload = { title: "Night Audit did not finish", body: "Demo Resort", url: "/e/x/dashboard", tag: "n1", urgent: true }

  it("does nothing when push is not configured", async () => {
    await sub(userA, "off")
    const send: PushSender = async () => { throw new Error("must not be called") }
    expect(await push.sendPushToUsers([userA], payload, { send, config: null })).toEqual({ sent: 0, dropped: 0, failed: 0 })
    await push.removeSubscription(`https://push.example.test/${tag}/off`)
  })

  it("sends only to the named users' devices, with a privacy-safe payload and high urgency when urgent", async () => {
    await sub(userA, "phone")
    await sub(userB, "laptop")
    const seen: { endpoint: string; body: string; urgency: string }[] = []
    const send: PushSender = async (s, body, opts) => { seen.push({ endpoint: s.endpoint, body, urgency: opts.urgency }) }
    const res = await push.sendPushToUsers([userA], payload, { send, config })
    expect(res.sent).toBe(1)
    expect(seen).toHaveLength(1)
    expect(seen[0].endpoint).toContain("/phone")
    expect(seen[0].urgency).toBe("high")
    expect(JSON.parse(seen[0].body)).toEqual({ title: payload.title, body: "Demo Resort", url: "/e/x/dashboard", tag: "n1" })
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: `https://push.example.test/${tag}/phone` } })
    expect(row.lastUsedAt).not.toBeNull()
  })

  it("the stored auth secret is not the plaintext when a key is configured", async () => {
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: `https://push.example.test/${tag}/phone` } })
    if (process.env.SECRETS_ENCRYPTION_KEY) expect(row.authEncrypted).not.toContain("a".repeat(16))
    else expect(row.authEncrypted.length).toBeGreaterThan(0)
  })

  it("a device the push service reports gone (410) is forgotten at once", async () => {
    await sub(userA, "gone")
    const send: PushSender = async (s) => { if (s.endpoint.endsWith("/gone")) throw Object.assign(new Error("gone"), { statusCode: 410 }) }
    const res = await push.sendPushToUsers([userA], payload, { send, config })
    expect(res.dropped).toBe(1)
    expect(await prisma.pushSubscription.count({ where: { endpoint: `https://push.example.test/${tag}/gone` } })).toBe(0)
    expect(await prisma.pushSubscription.count({ where: { endpoint: `https://push.example.test/${tag}/phone` } })).toBe(1)
  })

  it("a device that keeps failing is dropped after the limit, not before", async () => {
    await sub(userB, "flaky")
    const send: PushSender = async () => { throw Object.assign(new Error("boom"), { statusCode: 500 }) }
    for (let i = 1; i < push.MAX_FAILURES; i++) {
      await push.sendPushToUsers([userB], payload, { send, config })
      expect(await prisma.pushSubscription.count({ where: { endpoint: `https://push.example.test/${tag}/flaky` } })).toBe(1)
    }
    await push.sendPushToUsers([userB], payload, { send, config })
    expect(await prisma.pushSubscription.count({ where: { endpoint: `https://push.example.test/${tag}/flaky` } })).toBe(0)
  })

  it("registering the same device again replaces it instead of duplicating", async () => {
    await sub(userA, "phone")
    await sub(userA, "phone")
    expect(await prisma.pushSubscription.count({ where: { endpoint: `https://push.example.test/${tag}/phone` } })).toBe(1)
  })

  it("removeSubscription forgets the device and tolerates an unknown one", async () => {
    await push.removeSubscription(`https://push.example.test/${tag}/phone`)
    expect(await prisma.pushSubscription.count({ where: { endpoint: `https://push.example.test/${tag}/phone` } })).toBe(0)
    await expect(push.removeSubscription("https://push.example.test/never-existed")).resolves.toBeUndefined()
  })

  it("reads the VAPID settings only when all three are present", () => {
    expect(push.pushConfig({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })).toBeNull()
    expect(push.pushConfig({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", VAPID_SUBJECT: "mailto:x@y.z" })).toEqual({ publicKey: "a", privateKey: "b", subject: "mailto:x@y.z" })
  })
})
