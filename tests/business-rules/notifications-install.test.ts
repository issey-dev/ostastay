import { describe, it, expect, beforeAll } from "vitest"

// The install invitation is a one-time notification (not a pop-up). The "Install app" option
// in the Account dialog is only offered once the person has read it.

const { prisma } = await import("@/lib/db")
const { inviteToInstall, hasReadInstallInvite } = await import("@/lib/notifications/install-offer")
const { markRead } = await import("@/lib/notifications/inbox")
const { setPreference } = await import("@/lib/notifications/preferences")
import type { AuthContext } from "@/lib/scope"

describe("install invitation", () => {
  const tag = `inst-${Date.now()}`
  let ent: string, a: string, b: string, muted: string

  beforeAll(async () => {
    ent = (await prisma.enterprise.create({ data: { name: tag, slug: tag, type: "STANDARD" } })).id
    const mk = async (n: string) =>
      (await prisma.user.create({ data: { enterpriseId: ent, email: `${tag}-${n}@example.test`, passwordHash: "x", firstName: n, lastName: "T", scope: "ENTERPRISE" } })).id
    a = await mk("a")
    b = await mk("b")
    muted = await mk("muted")
  })

  const count = (userId: string) => prisma.notificationRecipient.count({ where: { userId, notification: { type: "INSTALL_APP" } } })

  it("is sent once per person, however many times they sign in", async () => {
    await inviteToInstall({ enterpriseId: ent, userId: a })
    await inviteToInstall({ enterpriseId: ent, userId: a })
    await inviteToInstall({ enterpriseId: ent, userId: a })
    expect(await count(a)).toBe(1)
  })

  it("goes only to the person signing in", async () => {
    expect(await count(b)).toBe(0)
    await inviteToInstall({ enterpriseId: ent, userId: b })
    expect(await count(b)).toBe(1)
    expect(await count(a)).toBe(1)
  })

  it("the Install option is offered only after the invitation was read", async () => {
    expect(await hasReadInstallInvite(a)).toBe(false)
    const row = await prisma.notificationRecipient.findFirstOrThrow({ where: { userId: a, notification: { type: "INSTALL_APP" } } })
    await markRead({ userId: a, enterpriseId: ent } as AuthContext, { ids: [row.id] })
    expect(await hasReadInstallInvite(a)).toBe(true)
    expect(await hasReadInstallInvite(b)).toBe(false)
  })

  it("someone who muted this kind is not sent it (and so is not offered the option)", async () => {
    await setPreference(muted, "INSTALL_APP", { inApp: false })
    await inviteToInstall({ enterpriseId: ent, userId: muted })
    expect(await count(muted)).toBe(0)
    expect(await hasReadInstallInvite(muted)).toBe(false)
  })

  it("it is a quiet note: it never goes to phones", async () => {
    const n = await prisma.notification.findFirstOrThrow({ where: { enterpriseId: ent, type: "INSTALL_APP" } })
    expect(n.severity).toBe("INFO")
    expect(n.scope).toBe("PERSONAL")
    expect(n.url).toBe("/docs/operations/install-the-app")
  })
})
