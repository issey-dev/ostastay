import { prisma } from "@/lib/db"
import { getOstaToday, type InboxItem } from "@/lib/osta/attention"
import { notify, type NotifyInput } from "./notify"

// Notifications for Uppsolut's own staff, raised from the SAME "Needs action" list the
// platform console's Today page shows (src/lib/osta/attention.ts). One source of truth: the
// bell can never mention something Today does not, and the other way round. Run by the
// "notification-alerts" job for the Osta (INTERNAL) enterprise only; every alert has a
// dedupe key, so the frequent cron raises each once.
//
// Text names the customer enterprise and the thing, never an amount or a person.

/** Pure: what one inbox item becomes (or null for a kind that is not raised). Exported for tests. */
export function ostaAlertFor(item: InboxItem, now: Date): Pick<NotifyInput, "type" | "title" | "body" | "url" | "entityType" | "entityId" | "dedupeKey"> | null {
  const day = now.toISOString().slice(0, 10)
  switch (item.kind) {
    case "approval":
      return {
        type: "OSTA_PROPERTY_REVIEW",
        title: "A property is waiting for approval",
        body: `${item.enterpriseName}: ${item.propertyName}`,
        url: `/osta/properties/${item.propertyId}`,
        entityType: "Property",
        entityId: item.propertyId,
        dedupeKey: `OSTA_PROPERTY_REVIEW:${item.propertyId}`,
      }
    case "channel":
      return {
        type: "OSTA_CHANNEL_FAILING",
        title: "A channel connection is failing",
        body: `${item.enterpriseName}: ${item.propertyName}`,
        url: "/osta/channel-manager",
        entityType: "ChannelConnection",
        entityId: item.connectionId,
        // Still failing tomorrow is worth hearing again; every few minutes is not.
        dedupeKey: `OSTA_CHANNEL_FAILING:${item.connectionId}:${day}`,
      }
    case "license":
      return {
        type: "OSTA_LICENSE",
        title: item.state === "GRACE" ? "A licence is in its grace period" : "A licence has expired",
        body: item.enterpriseName,
        url: `/osta/enterprises/${item.enterpriseId}`,
        entityType: "Enterprise",
        entityId: item.enterpriseId,
        // A new alert when the state changes, or the licence is renewed and later lapses again.
        dedupeKey: `OSTA_LICENSE:${item.enterpriseId}:${item.state}:${item.expiresAt ?? ""}`,
      }
    case "billing":
      return {
        type: "OSTA_BILLING",
        title: item.daysOverdue > 0 ? "A licence invoice is overdue" : "A licence invoice is unpaid",
        body: `${item.enterpriseName}: ${item.invoiceNo}`,
        url: "/osta/billing",
        entityType: "LicenseInvoice",
        entityId: item.invoiceId,
        dedupeKey: `OSTA_BILLING:${item.invoiceId}:${item.daysOverdue > 0 ? "overdue" : "issued"}`,
      }
  }
}

/** Raise notifications for the console's "Needs action" list. Only for the Osta enterprise. */
export async function scanOstaInbox(enterpriseId: string, now: Date = new Date()): Promise<number> {
  const ent = await prisma.enterprise.findUnique({ where: { id: enterpriseId }, select: { type: true } })
  if (ent?.type !== "INTERNAL") return 0
  const { inbox } = await getOstaToday(now)
  let raised = 0
  for (const item of inbox) {
    const alert = ostaAlertFor(item, now)
    if (!alert) continue
    const id = await notify({
      ...alert,
      enterpriseId,
      propertyId: null,
      // Osta staff who can see the console's enterprise and property pages (CONTROLS), as the
      // console's own APIs require.
      audience: { need: { module: "CONTROLS", action: "view" } },
    })
    if (id) raised += 1
  }
  return raised
}
