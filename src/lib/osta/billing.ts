import { prisma } from "@/lib/db"
import { computeLicenseState, type LicenseState } from "@/lib/license"

// The Osta finance overview (/osta/billing): read-only. Invoices are ISSUED, PAID or VOID
// (LicenseInvoice); issuing and marking paid happen on the enterprise's Billing tab.
// Money is kept per currency — nothing here converts between currencies.

const DAY = 86_400_000

export type MoneyByCurrency = Record<string, number>

export type BillingInvoice = {
  id: string
  invoiceNo: string
  enterpriseId: string
  enterpriseName: string
  periodStart: string
  periodEnd: string
  amount: number
  currency: string
  status: "ISSUED" | "PAID" | "VOID" | string
  overdue: boolean
  issuedAt: string
  dueAt: string | null
  paidAt: string | null
  receiptNo: string | null
  paymentReference: string | null
}

export type UpcomingInvoice = {
  enterpriseId: string
  enterpriseName: string
  periodStart: string
  periodEnd: string
  amount: number
  currency: string
  /** The period has started and has no invoice yet. */
  due: boolean
}

export type EnterpriseBilling = {
  enterpriseId: string
  enterpriseName: string
  licenseState: LicenseState
  expiresAt: string | null
  monthly: number | null
  currency: string
  outstanding: number
  overdue: number
  lastPaidAt: string | null
  paidThisYear: number
}

export type BillingOverview = {
  now: string
  kpis: {
    outstanding: MoneyByCurrency
    outstandingCount: number
    overdue: MoneyByCurrency
    overdueCount: number
    collectedMonth: MoneyByCurrency
    collectedPrevMonth: MoneyByCurrency
    invoicedMonth: MoneyByCurrency
    mrr: MoneyByCurrency
    upcomingCount: number
  }
  invoices: BillingInvoice[]
  upcoming: UpcomingInvoice[]
  enterprises: EnterpriseBilling[]
}

const add = (m: MoneyByCurrency, cur: string, n: number) => {
  m[cur] = (m[cur] ?? 0) + n
}
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
/** Same day next month, minus one day — a monthly period ending inclusive. */
const monthEnd = (start: Date) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()) - DAY)

export async function getBillingOverview(now = new Date()): Promise<BillingOverview> {
  const [rows, enterprises] = await Promise.all([
    prisma.licenseInvoice.findMany({
      orderBy: { issuedAt: "desc" },
      include: { enterprise: { select: { id: true, name: true } } },
    }),
    prisma.enterprise.findMany({
      where: { type: { not: "INTERNAL" } },
      select: { id: true, name: true, license: true },
      orderBy: { name: "asc" },
    }),
  ])

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))

  const invoices: BillingInvoice[] = rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoiceNo,
    enterpriseId: r.enterprise.id,
    enterpriseName: r.enterprise.name,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    overdue: r.status === "ISSUED" && !!r.dueAt && r.dueAt < now,
    issuedAt: r.issuedAt.toISOString(),
    dueAt: r.dueAt?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
    receiptNo: r.receiptNo,
    paymentReference: r.paymentReference,
  }))

  const k = {
    outstanding: {} as MoneyByCurrency,
    outstandingCount: 0,
    overdue: {} as MoneyByCurrency,
    overdueCount: 0,
    collectedMonth: {} as MoneyByCurrency,
    collectedPrevMonth: {} as MoneyByCurrency,
    invoicedMonth: {} as MoneyByCurrency,
    mrr: {} as MoneyByCurrency,
    upcomingCount: 0,
  }
  for (const r of rows) {
    if (r.status === "ISSUED") {
      add(k.outstanding, r.currency, r.amount)
      k.outstandingCount++
      if (r.dueAt && r.dueAt < now) {
        add(k.overdue, r.currency, r.amount)
        k.overdueCount++
      }
    }
    if (r.status === "PAID" && r.paidAt) {
      if (r.paidAt >= monthStart) add(k.collectedMonth, r.currency, r.amount)
      else if (r.paidAt >= prevMonthStart) add(k.collectedPrevMonth, r.currency, r.amount)
    }
    if (r.status !== "VOID" && r.issuedAt >= monthStart) add(k.invoicedMonth, r.currency, r.amount)
  }

  const upcoming: UpcomingInvoice[] = []
  const perEnterprise: EnterpriseBilling[] = []
  const horizon = new Date(now.getTime() + 30 * DAY)

  for (const e of enterprises) {
    const lic = e.license
    const { state } = computeLicenseState(lic, now)
    const mine = rows.filter((r) => r.enterpriseId === e.id)
    const live = state === "ACTIVE" || state === "GRACE"
    const monthly = lic?.monthlyPrice ?? null
    const currency = lic?.priceCurrency ?? "USD"
    if (live && monthly) add(k.mrr, currency, monthly)

    // Next monthly period: the day after the last (non-void) invoiced period ends, else
    // the licence start, else this month. Shown when it starts within 30 days and the
    // licence will still be running then.
    if (live && monthly && monthly > 0) {
      const lastEnd = mine.filter((r) => r.status !== "VOID").reduce<Date | null>((m, r) => (!m || r.periodEnd > m ? r.periodEnd : m), null)
      const start = lastEnd ? new Date(utcDay(lastEnd).getTime() + DAY) : utcDay(lic?.validFrom ?? monthStart)
      const stillLicensed = !lic?.expiresAt || start <= lic.expiresAt
      if (start <= horizon && stillLicensed) {
        upcoming.push({
          enterpriseId: e.id,
          enterpriseName: e.name,
          periodStart: start.toISOString(),
          periodEnd: monthEnd(start).toISOString(),
          amount: monthly,
          currency,
          due: start <= now,
        })
      }
    }

    const paid = mine.filter((r) => r.status === "PAID" && r.paidAt)
    perEnterprise.push({
      enterpriseId: e.id,
      enterpriseName: e.name,
      licenseState: state,
      expiresAt: lic?.expiresAt?.toISOString() ?? null,
      monthly,
      currency,
      outstanding: mine.filter((r) => r.status === "ISSUED").reduce((s, r) => s + r.amount, 0),
      overdue: mine.filter((r) => r.status === "ISSUED" && r.dueAt && r.dueAt < now).reduce((s, r) => s + r.amount, 0),
      lastPaidAt: paid.reduce<Date | null>((m, r) => (!m || r.paidAt! > m ? r.paidAt : m), null)?.toISOString() ?? null,
      paidThisYear: paid.filter((r) => r.paidAt! >= yearStart).reduce((s, r) => s + r.amount, 0),
    })
  }

  upcoming.sort((a, b) => a.periodStart.localeCompare(b.periodStart))
  k.upcomingCount = upcoming.length
  return { now: now.toISOString(), kpis: k, invoices, upcoming, enterprises: perEnterprise }
}
