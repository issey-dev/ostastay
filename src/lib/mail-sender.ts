import { prisma } from "@/lib/db"
import {
  deliverSmtp,
  getPlatformSmtpConfig,
  isTenantSmtpConfigured,
  resolveTenantSmtp,
  PlatformSmtpNotConfiguredError,
  SmtpNotConfiguredError,
  type MailContent,
  type ResolvedSmtp,
} from "@/lib/mailer"

// THE way application code sends email. src/lib/mailer.ts owns transports and credentials;
// this module owns two things that must never be optional:
//
//   1. WHICH SENDER an enterprise's mail goes out through, including the paid fallback.
//   2. THE LOG. Every send writes an EmailLog row, success or failure.
//
// The log is not diagnostics — it is the billing record. An enterprise on the
// PLATFORM_EMAIL add-on is charged from a count of its PLATFORM rows, so a send that
// bypassed this module is revenue that silently disappears. That is why deliverSmtp() is
// documented as internal and nothing outside this file calls it.

/**
 * Message categories, so a bill can be itemised by what was actually sent rather than one
 * undifferentiated total. Values are stored in EmailLog.kind — treat them as stable.
 */
export const MAIL_KINDS = {
  // Guest / customer facing — billable when they go out on the platform sender.
  CONFIRMATION_LETTER: "confirmation-letter",
  EREGISTRATION_LINK: "eregistration-link",
  DEBTOR_STATEMENT: "debtor-statement",
  FOLIO_INVOICE: "folio-invoice",
  PAYMENT_RECEIPT: "payment-receipt",
  EXCHANGE_RECEIPT: "exchange-receipt",
  REGISTRATION_CARD: "registration-card",
  // Uppsolut's own mail. Always PLATFORM, never billed to a tenant.
  ENTERPRISE_WELCOME: "enterprise-welcome",
  CHANNEL_ALERT: "channel-alert",
  SMTP_TEST: "smtp-test",
} as const

export type MailKind = (typeof MAIL_KINDS)[keyof typeof MAIL_KINDS]

export const MAIL_SENDER = { TENANT: "TENANT", PLATFORM: "PLATFORM" } as const
export type MailSender = (typeof MAIL_SENDER)[keyof typeof MAIL_SENDER]

export const MAIL_STATUS = { SENT: "SENT", FAILED: "FAILED" } as const

/** The service add-on key that buys use of Uppsolut's own SMTP. */
export const PLATFORM_EMAIL_ADDON = "PLATFORM_EMAIL"

/**
 * Whether this enterprise has bought the Uppsolut Mail Service.
 *
 * A missing row means "not purchased" — the same convention as every other add-on.
 */
export async function hasPlatformEmailAddon(enterpriseId: string): Promise<boolean> {
  const row = await prisma.enterpriseAddonAccess.findUnique({
    where: { enterpriseId_module: { enterpriseId, module: PLATFORM_EMAIL_ADDON } },
    select: { enabled: true },
  })
  return row?.enabled === true
}

export type SenderChoice = { smtp: ResolvedSmtp; sender: MailSender }

/**
 * Decide which account an enterprise's outgoing mail goes through.
 *
 * Order is the owner's rule (2026-08-10), and the precedence matters: the tenant's OWN
 * SMTP always wins when configured. Buying the mail service must never quietly take over
 * sending for a hotel that has its own domain set up — it is a fallback for enterprises
 * that have none, not a replacement.
 *
 *   1. Tenant SMTP, if the enterprise has configured it.
 *   2. Platform SMTP, if they bought PLATFORM_EMAIL and the platform sender is configured.
 *   3. Otherwise SmtpNotConfiguredError, exactly as before this add-on existed.
 */
export async function resolveEnterpriseSender(enterpriseId: string): Promise<SenderChoice> {
  const settings = await prisma.enterpriseSettings.findUnique({ where: { enterpriseId } })

  if (isTenantSmtpConfigured(settings)) {
    return { smtp: resolveTenantSmtp(settings), sender: MAIL_SENDER.TENANT }
  }

  if (await hasPlatformEmailAddon(enterpriseId)) {
    const platform = getPlatformSmtpConfig()
    // Bought the service but the deployment has no platform sender: that is an OPERATOR
    // fault, not a tenant misconfiguration, so it must not tell the hotel to go and set up
    // SMTP they are paying us not to need.
    if (!platform) throw new PlatformSmtpNotConfiguredError()
    return { smtp: platform, sender: MAIL_SENDER.PLATFORM }
  }

  throw new SmtpNotConfiguredError()
}

async function record(params: {
  enterpriseId: string | null
  sender: MailSender
  kind: MailKind
  smtp: ResolvedSmtp
  mail: MailContent
  status: string
  messageId?: string
  errorMessage?: string
}): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        enterpriseId: params.enterpriseId,
        sender: params.sender,
        kind: params.kind,
        toAddress: params.mail.to,
        fromAddress: params.smtp.fromAddress,
        subject: params.mail.subject,
        status: params.status,
        messageId: params.messageId ?? null,
        // Truncated: an SMTP rejection can be long, and this column exists to be read by a
        // human, not to hold a stack trace.
        errorMessage: params.errorMessage ? params.errorMessage.slice(0, 500) : null,
      },
    })
  } catch (e) {
    // Never let bookkeeping break the send. A message that went out but failed to log is
    // an under-bill; a message that failed to go out because logging broke is a guest who
    // never got their confirmation. The first is strictly the better failure.
    console.error("Failed to write EmailLog row:", e)
  }
}

async function deliverAndLog(params: {
  enterpriseId: string | null
  sender: MailSender
  kind: MailKind
  smtp: ResolvedSmtp
  mail: MailContent
}): Promise<{ sender: MailSender }> {
  const { enterpriseId, sender, kind, smtp, mail } = params
  try {
    const messageId = await deliverSmtp(smtp, mail)
    await record({ enterpriseId, sender, kind, smtp, mail, status: MAIL_STATUS.SENT, messageId })
    return { sender }
  } catch (e) {
    // FAILED rows are written deliberately: a rejected send is exactly what an operator
    // needs to see, and it must not be billed as if it had been delivered.
    await record({
      enterpriseId,
      sender,
      kind,
      smtp,
      mail,
      status: MAIL_STATUS.FAILED,
      errorMessage: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}

/**
 * Send mail on behalf of an ENTERPRISE — guest-facing messages.
 *
 * Uses the enterprise's own SMTP, or Uppsolut's if they bought the mail service. Returns
 * which sender was used so a route can tell the operator (and so a caller can assert on it).
 *
 * Throws SmtpNotConfiguredError when neither is available.
 */
export async function sendEnterpriseMail(
  params: { enterpriseId: string; kind: MailKind } & MailContent
): Promise<{ sender: MailSender }> {
  const { enterpriseId, kind, ...mail } = params
  const { smtp, sender } = await resolveEnterpriseSender(enterpriseId)
  return deliverAndLog({ enterpriseId, sender, kind, smtp, mail })
}

/**
 * Send as Uppsolut Stay itself — handover credentials, channel-manager alerts.
 *
 * `enterpriseId` is optional and only tags the log: this mail is Uppsolut's own, never
 * billable to the tenant it happens to concern, so it is always recorded as PLATFORM
 * regardless. Onboarding passes it so the row is attributable; alerts to the ops mailbox
 * pass it for the same reason.
 */
export async function sendPlatformMail(
  params: { kind: MailKind; enterpriseId?: string | null } & MailContent
): Promise<void> {
  const { kind, enterpriseId = null, ...mail } = params
  const smtp = getPlatformSmtpConfig()
  if (!smtp) throw new PlatformSmtpNotConfiguredError()
  await deliverAndLog({ enterpriseId, sender: MAIL_SENDER.PLATFORM, kind, smtp, mail })
}
