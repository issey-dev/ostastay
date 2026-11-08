import { prisma } from "@/lib/db"
import { computeLicenseState } from "@/lib/license"
import { CONNECTION_STATUS, MANAGED_BY } from "@/lib/channels/connection"

// What the Osta console needs someone to act on. Shared by the sidebar (counts on its
// items) and the Today page (the full list), so the badge on "Properties" and the
// approvals in Today's inbox can never disagree.

const DAY_MS = 24 * 60 * 60 * 1000

export type OstaNavCounts = {
  pendingProperties: number
  unpaidInvoices: number
  liveSupportGrants: number
  failingChannels: number
}

// Cheap counts only: this runs on every console page (the sidebar is in the layout).
export async function getOstaNavCounts(now: Date = new Date()): Promise<OstaNavCounts> {
  const [pendingProperties, unpaidInvoices, liveSupportGrants, failingChannels] = await Promise.all([
    prisma.property.count({ where: { status: "PENDING" } }),
    prisma.licenseInvoice.count({ where: { status: "ISSUED" } }),
    prisma.supportAccessGrant.count({ where: { status: "APPROVED", expiresAt: { gt: now } } }),
    // Only Uppsolut-run connections: an enterprise's own is theirs to fix (DECISIONS.md 2026-11-07).
    prisma.channelConnection.count({ where: { status: CONNECTION_STATUS.ERROR, managedBy: MANAGED_BY.OSTA } }),
  ])
  return { pendingProperties, unpaidInvoices, liveSupportGrants, failingChannels }
}

export type InboxKind = "approval" | "billing" | "license" | "channel"

// Dates go out as ISO strings: the inbox is a client component.
export type InboxItem =
  | {
      kind: "approval"
      id: string
      propertyId: string
      propertyName: string
      propertyCode: string
      enterpriseId: string
      enterpriseName: string
      submittedAt: string
      /** Properties the enterprise already uses (pending ones included) against its cap. */
      used: number
      cap: number
    }
  | {
      kind: "billing"
      id: string
      invoiceId: string
      invoiceNo: string
      enterpriseId: string
      enterpriseName: string
      amount: number
      currency: string
      issuedAt: string
      dueAt: string | null
      /** Whole days past due; 0 when not yet due or no due date. */
      daysOverdue: number
    }
  | {
      kind: "license"
      id: string
      enterpriseId: string
      enterpriseName: string
      state: "GRACE" | "EXPIRED"
      expiresAt: string | null
      graceEndsAt: string | null
    }
  | {
      kind: "channel"
      id: string
      connectionId: string
      connectionName: string
      enterpriseName: string
      propertyName: string
      lastError: string | null
      lastHealthCheckAt: string | null
    }

export type Renewal = {
  enterpriseId: string
  enterpriseName: string
  state: "ACTIVE" | "GRACE"
  /** The date that matters: expiry when active, end of grace when in grace. */
  date: string
  monthlyPrice: number | null
  currency: string
}

export async function getOstaToday(now: Date = new Date()) {
  const [enterprises, pendingProperties, unpaidInvoices, failingChannels, channelTotals, liveGrants, propertyCounts] =
    await Promise.all([
      prisma.enterprise.findMany({
        where: { type: "STANDARD" },
        select: { id: true, name: true, license: true },
        orderBy: { name: "asc" },
      }),
      prisma.property.findMany({
        where: { status: "PENDING" },
        select: { id: true, name: true, code: true, createdAt: true, enterprise: { select: { id: true, name: true, license: { select: { maxProperties: true } } } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.licenseInvoice.findMany({
        where: { status: "ISSUED" },
        select: { id: true, invoiceNo: true, amount: true, discountAmount: true, currency: true, issuedAt: true, dueAt: true, enterprise: { select: { id: true, name: true } } },
        orderBy: { issuedAt: "asc" },
      }),
      // Inbox: Uppsolut-run connections only (an enterprise's own is theirs to fix and its
      // error text is not Osta's to read). The KPI counts below are status-only, all of them.
      prisma.channelConnection.findMany({
        where: { status: CONNECTION_STATUS.ERROR, managedBy: MANAGED_BY.OSTA },
        select: { id: true, name: true, lastError: true, lastHealthCheckAt: true, enterprise: { select: { name: true } }, property: { select: { name: true } } },
        orderBy: { lastHealthCheckAt: "desc" },
      }),
      prisma.channelConnection.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.supportAccessGrant.findMany({
        where: { status: "APPROVED", expiresAt: { gt: now } },
        select: { id: true, expiresAt: true, reason: true, enterprise: { select: { id: true, name: true } } },
        orderBy: { expiresAt: "asc" },
      }),
      prisma.property.groupBy({ by: ["enterpriseId", "status"], _count: { _all: true } }),
    ])

  const licensed = enterprises.map((e) => ({ ...e, ...computeLicenseState(e.license, now) }))

  // Properties counted against the cap: everything not rejected (pending ones included,
  // since approving them is what would use the slot).
  const usedByEnterprise = new Map<string, number>()
  let liveProperties = 0
  for (const row of propertyCounts) {
    if (row.status !== "REJECTED") usedByEnterprise.set(row.enterpriseId, (usedByEnterprise.get(row.enterpriseId) ?? 0) + row._count._all)
    if (row.status === "ACTIVE") liveProperties += row._count._all
  }

  const mrrByCurrency: Record<string, number> = {}
  for (const e of licensed) {
    if ((e.state === "ACTIVE" || e.state === "GRACE") && e.license?.monthlyPrice) {
      const currency = e.license.priceCurrency || "USD"
      mrrByCurrency[currency] = (mrrByCurrency[currency] ?? 0) + e.license.monthlyPrice
    }
  }

  const receivablesByCurrency: Record<string, number> = {}
  let overdueCount = 0
  const billing: InboxItem[] = unpaidInvoices.map((inv) => {
    const net = inv.amount - inv.discountAmount
    receivablesByCurrency[inv.currency] = (receivablesByCurrency[inv.currency] ?? 0) + net
    const daysOverdue = inv.dueAt && inv.dueAt < now ? Math.floor((now.getTime() - inv.dueAt.getTime()) / DAY_MS) : 0
    if (inv.dueAt && inv.dueAt < now) overdueCount++
    return {
      kind: "billing",
      id: `billing:${inv.id}`,
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      enterpriseId: inv.enterprise.id,
      enterpriseName: inv.enterprise.name,
      amount: net,
      currency: inv.currency,
      issuedAt: inv.issuedAt.toISOString(),
      dueAt: inv.dueAt?.toISOString() ?? null,
      daysOverdue,
    }
  })
  // Most overdue first; not-yet-due ones after, oldest issue first.
  billing.sort((a, b) => (a.kind === "billing" && b.kind === "billing" ? b.daysOverdue - a.daysOverdue : 0))

  const approvals: InboxItem[] = pendingProperties.map((p) => ({
    kind: "approval",
    id: `approval:${p.id}`,
    propertyId: p.id,
    propertyName: p.name,
    propertyCode: p.code,
    enterpriseId: p.enterprise.id,
    enterpriseName: p.enterprise.name,
    submittedAt: p.createdAt.toISOString(),
    used: usedByEnterprise.get(p.enterprise.id) ?? 0,
    cap: p.enterprise.license?.maxProperties ?? 1,
  }))

  const licenses: InboxItem[] = licensed
    .filter((e) => e.state === "GRACE" || e.state === "EXPIRED")
    .map((e) => ({
      kind: "license" as const,
      id: `license:${e.id}`,
      enterpriseId: e.id,
      enterpriseName: e.name,
      state: e.state as "GRACE" | "EXPIRED",
      expiresAt: e.license?.expiresAt?.toISOString() ?? null,
      graceEndsAt: e.graceEndsAt?.toISOString() ?? null,
    }))
    // Grace first: those can still be saved before access locks.
    .sort((a, b) => (a.state === b.state ? 0 : a.state === "GRACE" ? -1 : 1))

  const channels: InboxItem[] = failingChannels.map((c) => ({
    kind: "channel",
    id: `channel:${c.id}`,
    connectionId: c.id,
    connectionName: c.name,
    enterpriseName: c.enterprise.name,
    propertyName: c.property.name,
    lastError: c.lastError,
    lastHealthCheckAt: c.lastHealthCheckAt?.toISOString() ?? null,
  }))

  const RENEWAL_WINDOW_DAYS = 60
  const renewalCutoff = new Date(now.getTime() + RENEWAL_WINDOW_DAYS * DAY_MS)
  const renewals: Renewal[] = licensed
    .flatMap((e): Renewal[] => {
      if (!e.license?.expiresAt) return []
      const date = e.state === "GRACE" ? e.graceEndsAt : e.state === "ACTIVE" ? e.license.expiresAt : null
      if (!date || date > renewalCutoff) return []
      return [{
        enterpriseId: e.id,
        enterpriseName: e.name,
        state: e.state as "ACTIVE" | "GRACE",
        date: date.toISOString(),
        monthlyPrice: e.license.monthlyPrice,
        currency: e.license.priceCurrency || "USD",
      }]
    })
    .sort((a, b) => a.date.localeCompare(b.date))

  const channelCount = (status: string) => channelTotals.find((t) => t.status === status)?._count._all ?? 0

  return {
    // Inbox order: things that block a customer first (approvals, failing channels), then
    // licences about to lock, then money.
    inbox: [...approvals, ...channels, ...licenses, ...billing],
    kpis: {
      mrrByCurrency,
      enterpriseCount: enterprises.length,
      liveProperties,
      pendingProperties: pendingProperties.length,
      receivablesByCurrency,
      unpaidCount: unpaidInvoices.length,
      overdueCount,
      renewals30: renewals.filter((r) => new Date(r.date).getTime() <= now.getTime() + 30 * DAY_MS).length,
      graceCount: licensed.filter((e) => e.state === "GRACE").length,
      channelsConnected: channelCount(CONNECTION_STATUS.CONNECTED),
      channelsFailing: channelCount(CONNECTION_STATUS.ERROR),
    },
    renewals,
    liveGrants: liveGrants.map((g) => ({
      id: g.id,
      enterpriseId: g.enterprise.id,
      enterpriseName: g.enterprise.name,
      reason: g.reason,
      expiresAt: g.expiresAt!.toISOString(),
    })),
  }
}
