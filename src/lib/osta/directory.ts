import { prisma } from "@/lib/db"
import { computeLicenseState, type LicenseState } from "@/lib/license"
import { CONNECTION_STATUS, MANAGED_BY } from "@/lib/channels/connection"
import { MODULE_LABELS, SERVICE_ADDON_LABELS, type Module, type ServiceAddon } from "@/lib/modules"

// One row per customer enterprise for the Osta Enterprises directory: licence, money,
// properties, add-ons and channel health side by side, so the list answers "who needs
// what" without opening each enterprise. Dates go out as ISO strings (client table).

// FAILING is only said of a connection Uppsolut runs; an enterprise's own Beds24 account is
// OK (running) or DOWN (not running), nothing more (owner, 2026-11-07; DECISIONS.md).
export type ChannelHealth = "NONE" | "OK" | "FAILING" | "DOWN"

export type DirectoryRow = {
  id: string
  name: string
  slug: string
  createdAt: string
  licenseState: LicenseState
  expiresAt: string | null
  graceEndsAt: string | null
  monthlyPrice: number | null
  currency: string
  maxProperties: number
  properties: { id: string; name: string; code: string; status: string }[]
  /** Properties that count against the cap (everything not rejected). */
  propertiesUsed: number
  liveProperties: number
  pendingProperties: number
  addons: string[]
  channel: ChannelHealth
  channelFailing: number
  unpaidAmount: number
  unpaidCount: number
  overdueCount: number
  lastInvoice: { invoiceNo: string; status: string; issuedAt: string; paidAt: string | null } | null
  supportLiveUntil: string | null
  /** No live property yet: created but not through onboarding. */
  onboarding: boolean
}

export async function getEnterpriseDirectory(now: Date = new Date()): Promise<DirectoryRow[]> {
  const enterprises = await prisma.enterprise.findMany({
    where: { type: "STANDARD" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      license: true,
      properties: { select: { id: true, name: true, code: true, status: true }, orderBy: { name: "asc" } },
      addonAccess: { where: { enabled: true }, select: { module: true } },
      channelConnections: { select: { status: true, managedBy: true } },
      licenseInvoices: {
        select: { invoiceNo: true, status: true, amount: true, discountAmount: true, issuedAt: true, dueAt: true, paidAt: true },
        orderBy: { issuedAt: "desc" },
      },
      supportGrantsReceived: {
        where: { status: "APPROVED", expiresAt: { gt: now } },
        select: { expiresAt: true },
        orderBy: { expiresAt: "desc" },
        take: 1,
      },
    },
  })

  return enterprises.map((e) => {
    const { state, graceEndsAt } = computeLicenseState(e.license, now)
    const unpaid = e.licenseInvoices.filter((i) => i.status === "ISSUED")
    const last = e.licenseInvoices.find((i) => i.status !== "VOID") ?? null
    const channelFailing = e.channelConnections.filter((c) => c.status === CONNECTION_STATUS.ERROR && c.managedBy === MANAGED_BY.OSTA).length
    const channelOk = e.channelConnections.length > 0 && e.channelConnections.every((c) => c.status === CONNECTION_STATUS.CONNECTED)
    const liveProperties = e.properties.filter((p) => p.status === "ACTIVE").length
    return {
      id: e.id,
      name: e.name,
      slug: e.slug,
      createdAt: e.createdAt.toISOString(),
      licenseState: state,
      expiresAt: e.license?.expiresAt?.toISOString() ?? null,
      graceEndsAt: graceEndsAt?.toISOString() ?? null,
      monthlyPrice: e.license?.monthlyPrice ?? null,
      currency: e.license?.priceCurrency || "USD",
      maxProperties: e.license?.maxProperties ?? 1,
      properties: e.properties,
      propertiesUsed: e.properties.filter((p) => p.status !== "REJECTED").length,
      liveProperties,
      pendingProperties: e.properties.filter((p) => p.status === "PENDING").length,
      addons: e.addonAccess
        .map((a) => MODULE_LABELS[a.module as Module] ?? SERVICE_ADDON_LABELS[a.module as ServiceAddon] ?? a.module)
        .sort(),
      channel: channelFailing > 0 ? "FAILING" : e.channelConnections.length === 0 ? "NONE" : channelOk ? "OK" : "DOWN",
      channelFailing,
      unpaidAmount: unpaid.reduce((sum, i) => sum + i.amount - i.discountAmount, 0),
      unpaidCount: unpaid.length,
      overdueCount: unpaid.filter((i) => i.dueAt && i.dueAt < now).length,
      lastInvoice: last
        ? { invoiceNo: last.invoiceNo, status: last.status, issuedAt: last.issuedAt.toISOString(), paidAt: last.paidAt?.toISOString() ?? null }
        : null,
      supportLiveUntil: e.supportGrantsReceived[0]?.expiresAt?.toISOString() ?? null,
      onboarding: liveProperties === 0,
    }
  })
}
