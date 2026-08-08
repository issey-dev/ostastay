import { Building2, ClipboardCheck, ShieldCheck, DollarSign, CalendarClock, ReceiptText } from "@/components/icons"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusBadge } from "@/components/ui/status-badge"
import { InfoHint } from "@/components/ui/info-hint"
import { EmptyState } from "@/components/ui/empty-state"
import { prisma } from "@/lib/db"
import { computeLicenseState } from "@/lib/license"

const EXPIRING_SOON_DAYS = 30

function formatMoney(amountsByCurrency: Record<string, number>): string {
  const entries = Object.entries(amountsByCurrency).filter(([, amount]) => amount !== 0)
  if (entries.length === 0) return "0.00"
  return entries
    .map(([currency, amount]) => `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(" · ")
}

export default async function OstaOverviewPage() {
  const [enterpriseCount, pendingPropertyCount, activeGrantCount, enterprises, unpaidInvoices] = await Promise.all([
    prisma.enterprise.count({ where: { type: "STANDARD" } }),
    prisma.property.count({ where: { status: "PENDING" } }),
    prisma.supportAccessGrant.count({ where: { status: "APPROVED" } }),
    prisma.enterprise.findMany({
      where: { type: "STANDARD" },
      select: { id: true, name: true, slug: true, license: true },
      orderBy: { name: "asc" },
    }),
    prisma.licenseInvoice.findMany({
      where: { status: "ISSUED" },
      select: { amount: true, discountAmount: true, currency: true },
    }),
  ])

  const now = new Date()
  const expiringSoonCutoff = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000)

  // Portfolio rollup — every STANDARD enterprise's license state, computed the same
  // pure way the login/session enforcement does, so this dashboard can never disagree
  // with what actually gates access.
  const licensed = enterprises.map((e) => ({
    ...e,
    ...computeLicenseState(e.license, now),
  }))

  const mrrByCurrency: Record<string, number> = {}
  for (const e of licensed) {
    if ((e.state === "ACTIVE" || e.state === "GRACE") && e.license?.monthlyPrice) {
      const currency = e.license.priceCurrency || "USD"
      mrrByCurrency[currency] = (mrrByCurrency[currency] ?? 0) + e.license.monthlyPrice
    }
  }

  const expiringSoon = licensed.filter(
    (e) => (e.state === "ACTIVE" || e.state === "GRACE") && e.license?.expiresAt && e.license.expiresAt <= expiringSoonCutoff
  )
  const needingAttention = licensed.filter((e) => e.state === "GRACE" || e.state === "EXPIRED")

  const unpaidByCurrency: Record<string, number> = {}
  for (const inv of unpaidInvoices) {
    unpaidByCurrency[inv.currency] = (unpaidByCurrency[inv.currency] ?? 0) + inv.amount - inv.discountAmount
  }

  const cards = [
    { title: "Enterprises", value: enterpriseCount, icon: Building2, href: "/osta/enterprises" },
    { title: "Pending Property Approvals", value: pendingPropertyCount, icon: ClipboardCheck, href: "/osta/properties" },
    { title: "Active Support Grants", value: activeGrantCount, icon: ShieldCheck, href: "/osta/support-access" },
  ]

  const licenseCards = [
    { title: "Monthly Recurring Revenue", value: formatMoney(mrrByCurrency), icon: DollarSign, href: "/osta/licensing" },
    { title: `Expiring Within ${EXPIRING_SOON_DAYS}d`, value: expiringSoon.length, icon: CalendarClock, href: "/osta/licensing" },
    { title: "Unpaid Invoices", value: `${unpaidInvoices.length} · ${formatMoney(unpaidByCurrency)}`, icon: ReceiptText, href: "/osta/licensing" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl">
            Overview
            <InfoHint label="Overview">Every enterprise, property, and support grant on the platform, in one place.</InfoHint>
          </h2>
      </div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {cards.map((c) => (
          <a key={c.title} href={c.href}>
            <Card className="shadow-elevation-1 hover:bg-muted/40 transition-colors">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{c.value}</div>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
          Licensing
          <InfoHint label="Licensing">Portfolio-wide rollup across every enterprise&apos;s license. Manage individual licenses from the Licensing screen.</InfoHint>
        </h3>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {licenseCards.map((c) => (
            <a key={c.title} href={c.href}>
              <Card className="shadow-elevation-1 hover:bg-muted/40 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
                  <c.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{c.value}</div>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      </div>

      <Card className="shadow-elevation-1">
        <CardHeader>
          <CardTitle className="text-base">Needs Attention</CardTitle>
        </CardHeader>
        <CardContent>
          {needingAttention.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No licenses in grace period or expired" />
          ) : (
            <div className="flex flex-col gap-1">
              {needingAttention.map((e) => (
                <a
                  key={e.id}
                  href={`/osta/enterprises/${e.id}`}
                  className="flex items-center justify-between gap-3 rounded-none border-b px-2 py-2.5 last:border-0 hover:bg-muted/50"
                >
                  <span className="text-sm font-medium">{e.name}</span>
                  <StatusBadge
                    label={e.state === "GRACE" ? "Grace Period" : "Expired"}
                    status={e.state}
                    dot
                  />
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
