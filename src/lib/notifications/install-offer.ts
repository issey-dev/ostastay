import { prisma } from "@/lib/db"
import { notify } from "./notify"

// The one-time invitation to install the app (replaces the card that used to pop up on every
// page). It is an ordinary notification, sent once per person, ever: the dedupe key never
// changes. Reading it is what unlocks the "Install app" option in the Account dialog.

export async function inviteToInstall(a: { enterpriseId: string; userId: string }): Promise<void> {
  await notify({
    type: "INSTALL_APP",
    enterpriseId: a.enterpriseId,
    propertyId: null,
    title: "Install Uppsolut Stay on your phone or computer",
    body: "Open it like an app, and get notifications on your phone. Open your profile (Account) and choose Install app.",
    url: "/docs/operations/install-the-app",
    dedupeKey: `INSTALL_APP:${a.userId}`,
    audience: { userIds: [a.userId] },
  })
}

/** Has this person opened the invitation? Only then is the Install option shown. */
export async function hasReadInstallInvite(userId: string): Promise<boolean> {
  const row = await prisma.notificationRecipient.findFirst({
    where: { userId, readAt: { not: null }, notification: { type: "INSTALL_APP" } },
    select: { id: true },
  })
  return row !== null
}
