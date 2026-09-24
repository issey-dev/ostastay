import { prisma } from "@/lib/db"
import { hasPermission, hasEnterpriseHubAccess, type AuthContext } from "@/lib/scope"
import { listHubProperties, loadHubAddons } from "@/lib/hub-properties"
import { getPropertySettings } from "@/lib/property-settings"
import { resolveChargeCode } from "@/lib/posting/resolve-charge-code"
import { registerOverview } from "@/lib/green-tax-registry"
import { JOBS } from "@/lib/jobs"
import { daysUntilRefreshTokenExpiry } from "@/lib/channels/beds24"
import { resolveBusinessDate } from "@/lib/business-date"
import { minutesPastAuditTime, propertyLocalNow } from "@/lib/night-audit/scheduled"
import { isTenantSmtpConfigured } from "@/lib/mailer"
import { hasPlatformEmailAddon } from "@/lib/mail-sender"

// The Hub Overview — "maintenance and config" (owner, 2026-09-23; HUB_SETUP_PLAN.md Phase 6).
// Nothing here is a link card or a dashboard: a banner appears only when something needs
// attention, says where, and links straight to the fix; when everything is in order the
// page says so and nothing else. Every check is scoped to the properties the user may set
// up, and to the modules they hold — a single-property admin sees their own property only,
// and never an enterprise-level item.

export type OverviewSeverity = "critical" | "warning"

export type OverviewBanner = {
  id: string
  severity: OverviewSeverity
  /** Whose problem this is: a property's name, or "Enterprise". */
  scope: string
  title: string
  detail: string
  /** Where to fix it — absent when there is nothing to fix in the app (a failed job). */
  href?: string
  actionLabel?: string
}

export type ChannelStatus = "ACTIVE" | "INACTIVE" | "ERROR" | "NOT_CONNECTED"

export type ChannelStatusRow = {
  propertyId: string
  propertyName: string
  status: ChannelStatus
  href: string
}

export type HubOverview = {
  banners: OverviewBanner[]
  /** Null when the user holds no INTEGRATIONS view (the strip is not shown at all). */
  channels: ChannelStatusRow[] | null
}

const SEVERITY_ORDER: Record<OverviewSeverity, number> = { critical: 0, warning: 1 }

export async function loadHubOverview(ctx: AuthContext, slug: string): Promise<HubOverview> {
  const properties = await listHubProperties(ctx)
  const addons = await loadHubAddons(ctx.enterpriseId)
  const canSetup = hasPermission(ctx, "CONTROLS", "view")
  const canIntegrations = hasPermission(ctx, "INTEGRATIONS", "view")
  const canGreenTax = hasPermission(ctx, "GREEN_TAX", "view")
  const banners: OverviewBanner[] = []
  const channels: ChannelStatusRow[] = []

  for (const p of properties) {
    const base = `/e/${slug}/hub/p/${p.id}`
    const add = (b: Omit<OverviewBanner, "scope" | "href"> & { path: string }) =>
      banners.push({ ...b, scope: p.name, href: `${base}/${b.path}` })

    if (canSetup) {
      const settings = await getPropertySettings(p.id)
      const [roomTypes, rooms, paymentMethods, room, greenTax, spaTreatments, excursionTypes] = await Promise.all([
        prisma.roomType.count({ where: { propertyId: p.id, isActive: true, isPseudo: false } }),
        prisma.room.count({ where: { propertyId: p.id } }),
        prisma.paymentMethod.count({ where: { propertyId: p.id, isActive: true } }),
        resolveChargeCode({ propertyId: p.id }, "ACCOMMODATION", { settings }),
        settings.greenTaxEnabled ? resolveChargeCode({ propertyId: p.id }, "GREEN_TAX", { settings }) : Promise.resolve(true),
        addons.has("SPA") ? prisma.spaTreatment.count({ where: { propertyId: p.id, isActive: true } }) : Promise.resolve(0),
        addons.has("EXCURSIONS") ? prisma.excursionType.count({ where: { propertyId: p.id, isActive: true } }) : Promise.resolve(0),
      ])

      if (roomTypes === 0) {
        add({ id: `${p.id}:room-types`, severity: "critical", title: "No room types yet", detail: "Nothing can be booked until this property has at least one room type.", path: "inventory", actionLabel: "Add room types" })
      } else if (rooms === 0) {
        add({ id: `${p.id}:rooms`, severity: "critical", title: "No rooms yet", detail: "Room types are set up but there are no rooms to assign guests to.", path: "inventory", actionLabel: "Add rooms" })
      }
      if (!room) {
        add({ id: `${p.id}:accommodation-code`, severity: "critical", title: "Room charges have no charge code", detail: "Night Audit cannot post room revenue until a default accommodation charge code is set.", path: "charge-codes", actionLabel: "Set posting defaults" })
      }
      if (!greenTax) {
        add({ id: `${p.id}:green-tax-code`, severity: "critical", title: "Green Tax has no charge code", detail: "Green Tax is switched on but there is no charge code to post it against.", path: "charge-codes", actionLabel: "Set posting defaults" })
      }
      if (paymentMethods === 0) {
        add({ id: `${p.id}:payment-methods`, severity: "critical", title: "No payment methods", detail: "Folios cannot be settled until this property accepts at least one payment method.", path: "finance", actionLabel: "Add payment methods" })
      }
      if (!settings.invoicePaymentIban && !settings.invoicePaymentAccountNumber && !settings.invoicePaymentBankInfo) {
        add({ id: `${p.id}:invoice-payment`, severity: "warning", title: "Invoices carry no payment details", detail: "No bank account, IBAN or bank details are set, so invoices do not tell guests how to pay.", path: "stationery", actionLabel: "Add payment details" })
      }
      if (!settings.cityLedgerPaymentMethodId) {
        add({ id: `${p.id}:city-ledger`, severity: "warning", title: "No City Ledger settlement method", detail: "A debtor folio cannot be settled to the city ledger at checkout.", path: "finance", actionLabel: "Set settlement default" })
      }
      // A scheduled Night Audit an hour past its time has not run — or stopped at a step
      // that needs a person (the job's error says which).
      if (settings.autoAuditEnabled) {
        const row = await prisma.property.findUnique({ where: { id: p.id }, select: { businessDate: true, timeZone: true } })
        if (row && minutesPastAuditTime(resolveBusinessDate(row), settings.autoAuditTime, propertyLocalNow(row.timeZone || "UTC")) >= 60) {
          add({ id: `${p.id}:night-audit-overdue`, severity: "critical", title: "Scheduled Night Audit has not completed", detail: `It was due at ${settings.autoAuditTime}. It may have stopped at a step that needs a person, such as guests still due out.`, path: "night-audit", actionLabel: "Open Night Audit" })
        }
      }
      if (spaTreatments > 0 && !settings.spaOutletId) {
        add({ id: `${p.id}:spa-outlet`, severity: "critical", title: "Spa charges cannot post", detail: "This property sells spa treatments but no outlet is linked to post them through.", path: "charge-codes", actionLabel: "Link the spa outlet" })
      }
      if (excursionTypes > 0 && !settings.excursionOutletId) {
        add({ id: `${p.id}:excursion-outlet`, severity: "critical", title: "Excursion charges cannot post", detail: "This property sells excursions but no outlet is linked to post them through.", path: "charge-codes", actionLabel: "Link the excursion outlet" })
      }
    }

    if (canIntegrations) {
      const [connection, overbookings, website, keys] = await Promise.all([
        prisma.channelConnection.findUnique({
          where: { propertyId: p.id },
          select: { status: true, lastError: true, lastTokenRefreshAt: true, propertyLinks: { select: { syncEnabled: true } } },
        }),
        prisma.channelInboundBooking.count({ where: { connection: { propertyId: p.id }, isOverbooking: true, acknowledgedAt: null } }),
        prisma.websitePropertySettings.findUnique({ where: { propertyId: p.id }, select: { bookingEnabled: true, ratePlanId: true } }),
        prisma.websiteApiKey.count({ where: { enterpriseId: ctx.enterpriseId, status: "ACTIVE", OR: [{ propertyId: p.id }, { propertyId: null }] } }),
      ])

      const status: ChannelStatus = !connection
        ? "NOT_CONNECTED"
        : connection.status === "ERROR"
          ? "ERROR"
          : connection.propertyLinks.some((l) => l.syncEnabled)
            ? "ACTIVE"
            : "INACTIVE"
      channels.push({ propertyId: p.id, propertyName: p.name, status, href: `${base}/channel-manager` })

      if (status === "ERROR") {
        add({ id: `${p.id}:channel-error`, severity: "critical", title: "Channel manager connection is failing", detail: connection?.lastError ?? "The last exchange with the channel manager failed.", path: "channel-manager", actionLabel: "Check the connection" })
      }
      // The keep-alive job refreshes the credential weekly; a week from the 30-day idle
      // limit means it has not been running — the "Check" button refreshes it by hand.
      const daysLeft = connection && status !== "ERROR" ? daysUntilRefreshTokenExpiry(connection.lastTokenRefreshAt) : null
      if (daysLeft !== null && daysLeft <= 7) {
        add({
          id: `${p.id}:channel-token`,
          severity: daysLeft <= 0 ? "critical" : "warning",
          title: daysLeft <= 0 ? "Channel manager credential has lapsed" : `Channel manager credential lapses in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
          detail: "It has not been refreshed recently. Run a check on the connection to refresh it; if that fails, contact Uppsolut.",
          path: "channel-manager",
          actionLabel: "Check the connection",
        })
      }
      if (overbookings > 0) {
        add({ id: `${p.id}:overbookings`, severity: "critical", title: `${overbookings} channel overbooking${overbookings === 1 ? "" : "s"} to resolve`, detail: "Bookings from the channels exceeded availability and have not been acknowledged.", path: "channel-manager/bookings", actionLabel: "Review bookings" })
      }
      if (keys > 0 && website && website.bookingEnabled && !website.ratePlanId) {
        add({ id: `${p.id}:website-rate-plan`, severity: "warning", title: "The website cannot take bookings", detail: "Online booking is on, but no rate plan is chosen for the website to sell.", path: "online-booking", actionLabel: "Choose a rate plan" })
      }
    }

    if (canGreenTax) {
      const year = new Date().getUTCFullYear()
      const register = await registerOverview(p.id, year)
      const openExceptions = register.exceptions.filter((e) => !e.locked).length
      const openGaps = register.gaps.filter((g) => !g.locked).length
      const currentMonth = new Date().getUTCMonth() + 1
      const unfiled = register.months.filter((m) => m.month < currentMonth && m.guests > 0 && !m.filedAt).length
      if (openExceptions > 0 || openGaps > 0) {
        const parts = [
          openExceptions ? `${openExceptions} registration${openExceptions === 1 ? "" : "s"} to review` : null,
          openGaps ? `${openGaps} gap${openGaps === 1 ? "" : "s"} in the numbering` : null,
        ].filter(Boolean)
        add({ id: `${p.id}:green-tax-issues`, severity: "critical", title: "Green Tax register needs attention", detail: `${parts.join(" and ")} (${year}).`, path: "green-tax", actionLabel: "Open the register" })
      }
      if (unfiled > 0) {
        add({ id: `${p.id}:green-tax-filing`, severity: "warning", title: `${unfiled} month${unfiled === 1 ? "" : "s"} not marked as filed`, detail: `Past months of ${year} with Green Tax guests have not been recorded as filed with MIRA.`, path: "green-tax", actionLabel: "Record filings" })
      }
    }
  }

  // Enterprise-level — never shown to a single-property user.
  if (hasEnterpriseHubAccess(ctx)) {
    const enterpriseBanner = (b: Omit<OverviewBanner, "scope">) => banners.push({ ...b, scope: "Enterprise" })

    if (hasPermission(ctx, "CONTROLS", "view")) {
      // Same test the sender uses (resolveEnterpriseSender in src/lib/mail-sender.ts): own
      // SMTP complete → it sends; otherwise the Uppsolut Mail Service (PLATFORM_EMAIL,
      // granted by Osta) sends on the enterprise's behalf. Only when neither applies is
      // guest mail actually blocked — an enterprise on the service has nothing to set up,
      // and being told otherwise sent them to fill in SMTP they pay us not to need.
      const smtp = await prisma.enterpriseSettings.findUnique({
        where: { enterpriseId: ctx.enterpriseId },
        select: { smtpHost: true, smtpPort: true, smtpUsername: true, smtpPassword: true, smtpFromAddress: true, smtpUseTls: true },
      })
      if (!isTenantSmtpConfigured(smtp) && !(await hasPlatformEmailAddon(ctx.enterpriseId))) {
        enterpriseBanner({
          id: "enterprise:smtp",
          severity: "warning",
          title: "Email is not set up",
          detail: smtp?.smtpHost
            ? "The outgoing mail settings are incomplete, so invoices, confirmations and receipts cannot be emailed to guests."
            : "Invoices, confirmations and receipts cannot be emailed to guests until an outgoing mail server is configured.",
          href: `/e/${slug}/hub/enterprise/email`,
          actionLabel: "Set up email",
        })
      }
    }

    // Background jobs only when something critical failed: the latest run of a job ended
    // in FAILED. A job that simply has not run yet is not a failure.
    if (hasPermission(ctx, "INTEGRATIONS", "view")) {
      for (const job of JOBS) {
        const last = await prisma.jobRun.findFirst({
          where: { enterpriseId: ctx.enterpriseId, jobName: job.name },
          orderBy: { startedAt: "desc" },
          select: { status: true, error: true, startedAt: true },
        })
        if (last?.status === "FAILED") {
          enterpriseBanner({
            id: `enterprise:job:${job.name}`,
            severity: "critical",
            title: `Background job failed: ${job.description}`,
            detail: `${last.error ?? "The last run failed."} Last run ${last.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC — if it keeps failing, contact Uppsolut support.`,
          })
        }
      }
    }
  }

  banners.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return { banners, channels: canIntegrations ? channels : null }
}
